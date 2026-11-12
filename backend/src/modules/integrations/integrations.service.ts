import { Injectable } from '@nestjs/common';
import { IntegrationStatus, Prisma } from '@prisma/client';
import { PageResult, WithMeta } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { PageQueryDto } from '../../common/dto/pagination.dto';
import { isIsoDate } from '../../common/time/dates';
import { AuditService } from '../audit/audit.service';
import { CircuitBreakerService } from '../integration-engine/circuit-breaker.service';
import { IntegrationEngine } from '../integration-engine/integration-engine.service';
import { ConnectivityService } from './connectivity.service';
import { CreateIntegrationDto, ListIntegrationsQueryDto, TestCallDto, UpdateIntegrationDto } from './dto/integrations.dto';

const include = {
  provider: { select: { id: true, code: true, name: true, type: true, active: true } },
  CircuitBreakerStateByIntegrationId: true,
} satisfies Prisma.IntegrationInclude;

type IntegrationRow = Prisma.IntegrationGetPayload<{ include: typeof include }>;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly connectivity: ConnectivityService,
    private readonly engine: IntegrationEngine,
    private readonly breaker: CircuitBreakerService,
  ) {}

  private toView(i: IntegrationRow) {
    const cb = i.CircuitBreakerStateByIntegrationId;
    return {
      id: i.id,
      name: i.name,
      adapterKind: i.adapterKind,
      enabled: i.enabled,
      status: i.status,
      lastHealthAt: i.lastHealthAt,
      lastError: i.lastError,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      provider: i.provider,
      circuitBreaker: cb && {
        state: cb.state,
        failureCount: cb.failureCount,
        successCount: cb.successCount,
        openedAt: cb.openedAt,
        nextAttemptAt: cb.nextAttemptAt,
      },
    };
  }

  async list(q: ListIntegrationsQueryDto) {
    const where: Prisma.IntegrationWhereInput = {
      ...(q.providerId && { providerId: q.providerId }),
      ...(q.adapterKind && { adapterKind: q.adapterKind }),
      ...(q.enabled !== undefined && { enabled: q.enabled }),
      ...(q.status && { status: q.status as IntegrationStatus }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.integration.findMany({ where, include, orderBy: [{ createdAt: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.integration.count({ where }),
    ]);
    return new PageResult(rows.map((r) => this.toView(r)), total, q.page, q.pageSize);
  }

  async get(id: string) {
    return this.toView(await this.require(id));
  }

  async create(dto: CreateIntegrationDto) {
    const provider = await this.prisma.provider.findUnique({ where: { id: dto.providerId }, select: { id: true } });
    if (!provider) throw Errors.badRequest('PROVIDER_NOT_FOUND', 'El proveedor indicado no existe');
    if (await this.prisma.integration.findUnique({ where: { providerId_name: { providerId: dto.providerId, name: dto.name } }, select: { id: true } })) {
      throw Errors.conflict('INTEGRATION_NAME_IN_USE', 'El proveedor ya tiene una integracion con ese nombre');
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.integration.create({
        data: {
          providerId: dto.providerId,
          name: dto.name,
          adapterKind: dto.adapterKind,
          CircuitBreakerStateByIntegrationId: { create: {} }, // nace CLOSED
        },
        include,
      });
      const view = this.toView(created);
      await this.audit.record({ action: 'INTEGRATION_CREATED', entity: 'integration', entityId: created.id, after: view }, tx);
      return view;
    });
  }

  async update(id: string, dto: UpdateIntegrationDto) {
    const current = await this.require(id);
    if (dto.name && dto.name !== current.name) {
      const dup = await this.prisma.integration.findUnique({ where: { providerId_name: { providerId: current.provider.id, name: dto.name } }, select: { id: true } });
      if (dup) throw Errors.conflict('INTEGRATION_NAME_IN_USE', 'El proveedor ya tiene una integracion con ese nombre');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.integration.update({ where: { id }, data: { ...(dto.name && { name: dto.name }) }, include });
      await this.audit.record({ action: 'INTEGRATION_UPDATED', entity: 'integration', entityId: id, before: this.toView(current), after: this.toView(updated) }, tx);
      return this.toView(updated);
    });
  }

  /** Reglas de habilitacion: proveedor activo, ficha tecnica si usa red, y Boomi solo cuando exista conexion real. */
  async setEnabled(id: string, enabled: boolean) {
    const current = await this.require(id);
    if (current.enabled === enabled) return this.toView(current);

    if (enabled) {
      if (!current.provider.active) throw Errors.conflict('PROVIDER_INACTIVE', 'No se puede habilitar una integracion de un proveedor inactivo');
      if (current.adapterKind === 'BOOMI') {
        throw Errors.conflict('BOOMI_NOT_AVAILABLE', 'Boomi esta preparado pero no tiene conexion real (faltan credenciales, licencia y documentacion oficial)');
      }
      if (current.adapterKind === 'HTTP') {
        const cfg = await this.prisma.providerConfig.findUnique({ where: { providerId: current.provider.id }, select: { id: true } });
        if (!cfg) throw Errors.conflict('PROVIDER_NOT_CONFIGURED', 'Defina la ficha tecnica del proveedor antes de habilitar la integracion');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.integration.update({ where: { id }, data: { enabled }, include });
      await this.audit.record(
        { action: enabled ? 'INTEGRATION_ENABLED' : 'INTEGRATION_DISABLED', entity: 'integration', entityId: id, before: { enabled: current.enabled }, after: { enabled } },
        tx,
      );
      return this.toView(updated);
    });
  }

  /** Ejecuta una comprobacion de conectividad real, guarda el resultado en el historial y actualiza el estado. */
  async runHealthCheck(id: string) {
    await this.require(id);
    const result = await this.connectivity.check(id);
    const checkedById = getRequestContext()?.userId ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.integrationHealthCheck.create({
        data: { integrationId: id, success: result.success, latencyMs: result.latencyMs, statusCode: result.statusCode, message: result.message, checkedById },
      });
      await tx.integration.update({
        where: { id },
        data: { status: result.status, lastHealthAt: new Date(), lastError: result.success ? null : result.message },
      });
      await this.audit.record({ action: 'INTEGRATION_HEALTH_CHECKED', entity: 'integration', entityId: id, after: { status: result.status, message: result.message } }, tx);
    });
    return { ...result, integration: await this.get(id) };
  }

  /**
   * Consola de pruebas: ejecuta una lectura real contra el proveedor por el motor (con timeout,
   * reintentos, circuito y trazabilidad). Un fallo del proveedor es un resultado valido (ok: false).
   */
  async testCall(id: string, dto: TestCallDto) {
    const current = await this.require(id);
    const dates = (d?: { startDate: string; endDate?: string }) => {
      if (!d) return;
      if (!isIsoDate(d.startDate) || (d.endDate !== undefined && !isIsoDate(d.endDate))) {
        throw Errors.badRequest('INVALID_DATE', 'Las fechas deben ser fechas calendario validas (YYYY-MM-DD)');
      }
      if (d.endDate !== undefined && d.endDate < d.startDate) throw Errors.badRequest('INVALID_DATE_RANGE', 'endDate no puede ser anterior a startDate');
    };
    let result;
    if (dto.operation === 'SEARCH') {
      if (!dto.availability) throw Errors.badRequest('MISSING_REQUEST', 'SEARCH requiere el campo availability');
      dates(dto.availability);
      result = await this.engine.search(id, { ...dto.availability });
    } else if (dto.operation === 'GET_RATES') {
      if (!dto.rates) throw Errors.badRequest('MISSING_REQUEST', 'GET_RATES requiere el campo rates');
      dates(dto.rates);
      const products = dto.rates.products.map((p) => ({ providerCode: current.provider.code, externalId: p.externalId }));
      result = await this.engine.getRates(id, { ...dto.rates, products });
    } else {
      if (!dto.booking) throw Errors.badRequest('MISSING_REQUEST', 'QUERY_BOOKING requiere el campo booking');
      result = await this.engine.queryBooking(id, { ...dto.booking });
    }
    await this.audit.record({ action: 'INTEGRATION_TEST_CALL', entity: 'integration', entityId: id, after: { operation: dto.operation, ok: result.ok, transactionId: result.transactionId } });
    const { transactionId, ...body } = result;
    return new WithMeta(body, transactionId ? { transactionId } : {});
  }

  /** Cierre manual del circuito (ADMIN), p. ej. tras corregir la configuracion del proveedor. */
  async resetCircuit(id: string) {
    await this.require(id);
    await this.prisma.$transaction(async (tx) => {
      const before = await this.breaker.reset(id, tx);
      await this.audit.record({ action: 'INTEGRATION_CIRCUIT_RESET', entity: 'integration', entityId: id, before, after: { state: 'CLOSED' } }, tx);
    });
    return this.get(id);
  }

  async healthHistory(id: string, q: PageQueryDto) {
    await this.require(id);
    const where = { integrationId: id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.integrationHealthCheck.findMany({ where, orderBy: { checkedAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.integrationHealthCheck.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }

  /** Solo se elimina una integracion sin transacciones asociadas; si tiene historia se deshabilita. */
  async remove(id: string): Promise<{ deleted: true }> {
    const current = await this.require(id);
    const transactions = await this.prisma.integrationTransaction.count({ where: { integrationId: id } });
    if (transactions > 0) {
      throw Errors.conflict('INTEGRATION_HAS_HISTORY', 'La integracion tiene transacciones asociadas. Deshabilitela en lugar de eliminarla', { transactions });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.integration.delete({ where: { id } });
      await this.audit.record({ action: 'INTEGRATION_DELETED', entity: 'integration', entityId: id, before: this.toView(current) }, tx);
    });
    return { deleted: true };
  }

  private async require(id: string): Promise<IntegrationRow> {
    const row = await this.prisma.integration.findUnique({ where: { id }, include });
    if (!row) throw Errors.notFound('INTEGRATION_NOT_FOUND', 'Integracion no encontrada');
    return row;
  }
}
