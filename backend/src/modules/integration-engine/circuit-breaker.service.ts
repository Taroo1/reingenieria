import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { SystemLogService } from '../audit/system-log.service';
import { AlertsService, circuitAlertKey } from './alerts.service';
import * as cb from './circuit-breaker';

interface Row {
  id: string;
  state: cb.CircuitStateName;
  failure_count: number;
  success_count: number;
  opened_at: Date | null;
  next_attempt_at: Date | null;
}

export interface BreakerContext {
  integrationId: string;
  providerId: string;
  integrationName: string;
}

const toState = (r: Row): cb.BreakerState => ({
  state: r.state,
  failureCount: r.failure_count,
  successCount: r.success_count,
  openedAt: r.opened_at,
  nextAttemptAt: r.next_attempt_at,
});

/**
 * Circuit breaker persistido en circuit_breaker_states. Las transiciones se hacen con SELECT ... FOR UPDATE
 * sobre la fila de la integracion: dos replicas no pueden abrir/cerrar el mismo circuito a la vez ni
 * duplicar la alerta. El camino feliz (CLOSED, sin fallas previas) solo lee, sin bloquear.
 */
@Injectable()
export class CircuitBreakerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly systemLog: SystemLogService,
  ) {}

  private async peek(integrationId: string): Promise<cb.BreakerState> {
    const row = await this.prisma.circuitBreakerState.findUnique({ where: { integrationId } });
    if (!row) return cb.initialState();
    return { state: row.state, failureCount: row.failureCount, successCount: row.successCount, openedAt: row.openedAt, nextAttemptAt: row.nextAttemptAt };
  }

  private async lock(tx: PrismaTx, integrationId: string): Promise<cb.BreakerState> {
    const rows = await tx.$queryRaw<Row[]>`
      SELECT id, state::text AS state, failure_count, success_count, opened_at, next_attempt_at
      FROM circuit_breaker_states WHERE integration_id = ${integrationId}::uuid FOR UPDATE`;
    if (rows[0]) return toState(rows[0]);
    // Integraciones creadas sin fila de estado: se crea y se bloquea.
    await tx.circuitBreakerState.upsert({ where: { integrationId }, update: {}, create: { integrationId } });
    const again = await tx.$queryRaw<Row[]>`
      SELECT id, state::text AS state, failure_count, success_count, opened_at, next_attempt_at
      FROM circuit_breaker_states WHERE integration_id = ${integrationId}::uuid FOR UPDATE`;
    return toState(again[0]);
  }

  private async write(tx: PrismaTx, integrationId: string, s: cb.BreakerState): Promise<void> {
    await tx.circuitBreakerState.update({
      where: { integrationId },
      data: { state: s.state, failureCount: s.failureCount, successCount: s.successCount, openedAt: s.openedAt, nextAttemptAt: s.nextAttemptAt },
    });
  }

  async acquire(integrationId: string, cfg: cb.BreakerConfig): Promise<cb.AcquireDecision> {
    const quick = await this.peek(integrationId);
    if (quick.state === 'CLOSED') return { allowed: true, trial: false, next: null };
    return this.prisma.$transaction(async (tx) => {
      const s = await this.lock(tx, integrationId);
      const d = cb.acquire(s, new Date(), cfg);
      if (d.allowed && d.next) await this.write(tx, integrationId, d.next);
      return d;
    });
  }

  async recordSuccess(ctx: BreakerContext, cfg: cb.BreakerConfig): Promise<void> {
    const quick = await this.peek(ctx.integrationId);
    if (quick.state === 'CLOSED' && quick.failureCount === 0) return;
    const transition = await this.prisma.$transaction(async (tx) => {
      const s = await this.lock(tx, ctx.integrationId);
      const r = cb.onSuccess(s, cfg);
      if (r.next) await this.write(tx, ctx.integrationId, r.next);
      if (r.transition === 'CLOSED') {
        await this.alerts.resolveByKey(circuitAlertKey(ctx.integrationId), tx);
        await tx.integration.update({ where: { id: ctx.integrationId }, data: { status: 'HEALTHY', lastError: null } });
      }
      return r.transition;
    });
    if (transition === 'CLOSED') {
      await this.systemLog.write('INFO', 'circuit-breaker', `Circuito CERRADO para ${ctx.integrationName}: el proveedor volvio a responder`, { integrationId: ctx.integrationId });
    }
  }

  async recordFailure(ctx: BreakerContext, cfg: cb.BreakerConfig, reason: string): Promise<void> {
    const transition = await this.prisma.$transaction(async (tx) => {
      const s = await this.lock(tx, ctx.integrationId);
      const r = cb.onFailure(s, new Date(), cfg);
      if (r.next) await this.write(tx, ctx.integrationId, r.next);
      if (r.transition === 'OPENED') {
        const message = `Circuito ABIERTO para ${ctx.integrationName} tras fallas consecutivas. Ultimo error: ${reason}`;
        await this.alerts.raise(
          { kind: 'CIRCUIT_OPEN', severity: 'HIGH', message, dedupeKey: circuitAlertKey(ctx.integrationId), integrationId: ctx.integrationId, providerId: ctx.providerId },
          tx,
        );
        await tx.integration.update({ where: { id: ctx.integrationId }, data: { status: 'DOWN', lastError: reason.slice(0, 1000) } });
      }
      return r.transition;
    });
    if (transition === 'OPENED') {
      await this.systemLog.write('ERROR', 'circuit-breaker', `Circuito ABIERTO para ${ctx.integrationName}`, { integrationId: ctx.integrationId, reason });
    }
  }

  /** Libera el lease de prueba si la llamada no llego a ejecutarse. */
  async release(integrationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const s = await this.lock(tx, integrationId);
      const next = cb.release(s);
      if (next) await this.write(tx, integrationId, next);
    });
  }

  /** Cierre manual (ADMIN): vuelve a CLOSED y resuelve la alerta. Devuelve el estado anterior. */
  async reset(integrationId: string, tx: PrismaTx): Promise<cb.BreakerState> {
    const s = await this.lock(tx, integrationId);
    await this.write(tx, integrationId, cb.initialState());
    await this.alerts.resolveByKey(circuitAlertKey(integrationId), tx);
    return s;
  }
}
