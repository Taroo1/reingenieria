import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { ListAlertsQueryDto } from './dto/monitoring.dto';

interface TxStatsRow {
  integration_id: string;
  total: bigint;
  success: bigint;
  failed: bigint;
  timeout: bigint;
  rejected: bigint;
  short_circuited: bigint;
  p50: number | null;
  p95: number | null;
}

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tablero operativo: salud por integracion (ultimas 24 h), alertas, excepciones, reservas y sincronizaciones. */
  async overview() {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [integrations, stats, alerts, exceptions, bookings, lastSyncs] = await Promise.all([
      this.prisma.integration.findMany({
        include: { provider: { select: { id: true, code: true, name: true, type: true } }, CircuitBreakerStateByIntegrationId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.$queryRaw<TxStatsRow[]>`
        SELECT integration_id,
               count(*) AS total,
               count(*) FILTER (WHERE status = 'SUCCESS') AS success,
               count(*) FILTER (WHERE status = 'FAILED') AS failed,
               count(*) FILTER (WHERE status = 'TIMEOUT') AS timeout,
               count(*) FILTER (WHERE status = 'REJECTED') AS rejected,
               count(*) FILTER (WHERE status = 'SHORT_CIRCUITED') AS short_circuited,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE status <> 'SHORT_CIRCUITED') AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE status <> 'SHORT_CIRCUITED') AS p95
          FROM integration_transactions
         WHERE started_at >= ${since} AND integration_id IS NOT NULL AND operation <> 'HEALTH_CHECK'
         GROUP BY integration_id`,
      this.prisma.alert.groupBy({ by: ['severity'], where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } }),
      this.prisma.exceptionCase.groupBy({ by: ['severity'], where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, _count: { _all: true } }),
      this.prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20, select: { id: true, kind: true, status: true, integrationId: true, startedAt: true, finishedAt: true, itemsProcessed: true, itemsChanged: true, inconsistenciesFound: true } }),
    ]);
    const byIntegration = new Map(stats.map((s) => [s.integration_id, s]));
    const count = (rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
      Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));

    return {
      generatedAt: new Date().toISOString(),
      window: { from: since.toISOString(), hours: 24 },
      integrations: integrations.map((i) => {
        const s = byIntegration.get(i.id);
        const total = Number(s?.total ?? 0);
        const success = Number(s?.success ?? 0);
        const cb = i.CircuitBreakerStateByIntegrationId;
        return {
          id: i.id, name: i.name, adapterKind: i.adapterKind, enabled: i.enabled, status: i.status, lastHealthAt: i.lastHealthAt, lastError: i.lastError, provider: i.provider,
          circuit: cb ? { state: cb.state, failureCount: cb.failureCount, openedAt: cb.openedAt, nextAttemptAt: cb.nextAttemptAt } : null,
          last24h: {
            calls: total, success, failed: Number(s?.failed ?? 0), timeout: Number(s?.timeout ?? 0), rejected: Number(s?.rejected ?? 0),
            shortCircuited: Number(s?.short_circuited ?? 0),
            successRate: total > 0 ? Math.round((success / total) * 10_000) / 100 : null,
            latencyMs: { p50: s?.p50 === null || s?.p50 === undefined ? null : Math.round(s.p50), p95: s?.p95 === null || s?.p95 === undefined ? null : Math.round(s.p95) },
          },
        };
      }),
      alertsOpenBySeverity: count(alerts, 'severity'),
      exceptionsOpenBySeverity: count(exceptions, 'severity'),
      bookingsByStatus: count(bookings, 'status'),
      recentSyncRuns: lastSyncs,
    };
  }

  async listAlerts(q: ListAlertsQueryDto) {
    const where: Prisma.AlertWhereInput = {
      ...(q.status && { status: q.status }), ...(q.kind && { kind: q.kind }), ...(q.severity && { severity: q.severity }), ...(q.integrationId && { integrationId: q.integrationId }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: q.skip, take: q.pageSize,
        include: { integration: { select: { id: true, name: true } }, provider: { select: { id: true, code: true } }, acknowledgedBy: { select: { id: true, email: true } } },
      }),
      this.prisma.alert.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }

  async acknowledge(id: string) {
    const a = await this.prisma.alert.findUnique({ where: { id } });
    if (!a) throw Errors.notFound('ALERT_NOT_FOUND', 'Alerta no encontrada');
    if (a.status !== 'OPEN') throw Errors.conflict('ALERT_NOT_OPEN', 'Solo se reconoce una alerta abierta');
    const userId = getRequestContext()?.userId ?? null;
    const updated = await this.prisma.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedById: userId, acknowledgedAt: new Date() } });
    await this.audit.record({ action: 'ALERT_ACKNOWLEDGED', entity: 'alert', entityId: id });
    return updated;
  }

  async resolve(id: string) {
    const a = await this.prisma.alert.findUnique({ where: { id } });
    if (!a) throw Errors.notFound('ALERT_NOT_FOUND', 'Alerta no encontrada');
    if (a.status === 'RESOLVED') return a;
    const updated = await this.prisma.alert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    await this.audit.record({ action: 'ALERT_RESOLVED', entity: 'alert', entityId: id });
    return updated;
  }
}
