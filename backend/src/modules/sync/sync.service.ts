import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InconsistencyKind, Prisma, ProductType, SyncKind } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import type { Env } from '../../common/config/env.validation';
import { getRequestContext } from '../../common/context/request-context';
import { toJsonInput } from '../../common/database/json';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { fromCents, toCents } from '../../common/money/money';
import { addDaysIso, todayIso, toIsoDate } from '../../common/time/dates';
import { AvailabilityQuery, CanonicalAvailability, ExternalRef, ProductKind } from '../normalization/canonical';
import { AuditService } from '../audit/audit.service';
import { CatalogService, PRODUCT_ENTITY } from '../catalog/catalog.service';
import { ExceptionsService } from '../exceptions/exceptions.service';
import { AlertsService } from '../integration-engine/alerts.service';
import { IntegrationEngine } from '../integration-engine/integration-engine.service';
import { InventoryService } from '../inventory/inventory.service';
import { RatesService } from '../rates/rates.service';
import { CloseInconsistencyDto, ListInconsistenciesQueryDto, ListSyncRunsQueryDto, SyncKindName } from './dto/sync.dto';

/** Una corrida RUNNING mas vieja que esto se considera abandonada (proceso caido) y deja de bloquear. */
const STALE_RUN_MS = 30 * 60_000;
const RATE_BATCH = 50;
const MAX_RANGE_DAYS = 60;

interface Counters {
  processed: number;
  changed: number;
  inconsistencies: number;
  failures: string[];
}

interface Ctx {
  runId: string;
  integrationId: string;
  providerId: string;
  providerCode: string;
  kinds: ProductKind[];
  window: { from: string; to: string };
  c: Counters;
}

/**
 * Sincronizacion con proveedores (manual o periodica):
 *  - CATALOG: trae productos, los normaliza y guarda external_references; marca los que ya no ofrece.
 *  - AVAILABILITY: guarda availability_snapshots; para cupo propio compara lo informado con la base.
 *  - RATES: actualiza tarifas de productos en vivo (con historial) y compara las del cupo propio.
 *  - BOOKINGS: compara el estado de las reservas confirmadas con el que informa el proveedor.
 * Cada corrida queda en sync_runs; cada diferencia, en inconsistencies (sin duplicar las abiertas).
 * Una sola corrida por (tipo, integracion) a la vez, aun con varias replicas: advisory lock + lease en sync_runs.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: IntegrationEngine,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly rates: RatesService,
    private readonly alerts: AlertsService,
    private readonly exceptions: ExceptionsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async run(kind: SyncKindName, integrationId: string) {
    const integration = await this.prisma.integration.findUnique({ where: { id: integrationId }, include: { provider: { include: { providerServicesByProviderId: true } } } });
    if (!integration) throw Errors.notFound('INTEGRATION_NOT_FOUND', 'Integracion no encontrada');
    if (!integration.enabled || !integration.provider.active) throw Errors.conflict('INTEGRATION_DISABLED', 'La integracion esta deshabilitada');

    const runId = await this.claim(kind, integration.id, integration.providerId);
    if (!runId) throw Errors.conflict('SYNC_IN_PROGRESS', 'Ya hay una sincronizacion de ese tipo en curso para la integracion');

    const days = this.config.get('SYNC_WINDOW_DAYS', { infer: true });
    const from = addDaysIso(todayIso(), 1);
    const ctx: Ctx = {
      runId, integrationId: integration.id, providerId: integration.providerId, providerCode: integration.provider.code,
      kinds: integration.provider.providerServicesByProviderId.filter((s) => s.canSearch).map((s) => s.serviceType as ProductKind),
      window: { from, to: addDaysIso(from, Math.min(days, MAX_RANGE_DAYS) - 1) },
      c: { processed: 0, changed: 0, inconsistencies: 0, failures: [] },
    };
    let fatal: string | null = null;
    try {
      if (kind === 'CATALOG') await this.syncCatalog(ctx);
      else if (kind === 'AVAILABILITY') await this.syncAvailability(ctx);
      else if (kind === 'RATES') await this.syncRates(ctx);
      else await this.syncBookings(ctx);
    } catch (e) {
      fatal = (e as Error).message;
    }

    const status = fatal || (ctx.c.failures.length > 0 && ctx.c.processed === 0) ? 'FAILED' : ctx.c.failures.length > 0 ? 'PARTIAL' : 'SUCCESS';
    const errorMessage = fatal ?? (ctx.c.failures.length ? ctx.c.failures.slice(0, 5).join('; ') : null);
    const run = await this.prisma.syncRun.update({
      where: { id: runId },
      data: { status, finishedAt: new Date(), itemsProcessed: ctx.c.processed, itemsChanged: ctx.c.changed, inconsistenciesFound: ctx.c.inconsistencies, errorMessage: errorMessage?.slice(0, 2000) ?? null },
    });
    const alertKey = `SYNC_FAILED:${kind}:${integration.id}`;
    if (status === 'FAILED') {
      await this.alerts.raise({ kind: 'SYNC_FAILED', severity: 'MEDIUM', message: `Fallo la sincronizacion ${kind} de ${integration.name}: ${errorMessage}`, dedupeKey: alertKey, integrationId: integration.id, providerId: integration.providerId });
    } else {
      await this.alerts.resolveByKey(alertKey);
    }
    if (ctx.c.inconsistencies > 0) {
      await this.alerts.raise({
        kind: 'INCONSISTENCY', severity: 'MEDIUM', message: `${ctx.c.inconsistencies} diferencia(s) nueva(s) con ${integration.provider.code} (${kind})`,
        dedupeKey: `INCONSISTENCY:${kind}:${integration.id}`, integrationId: integration.id, providerId: integration.providerId,
      });
    }
    return run;
  }

  // ---------------- lease ----------------

  private async claim(kind: SyncKindName, integrationId: string, providerId: string): Promise<string | null> {
    const ctx = getRequestContext();
    return this.prisma.$transaction(async (tx) => {
      // pg_advisory_xact_lock devuelve void (Prisma no lo deserializa): se invoca desde FROM.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`sync:${kind}:${integrationId}`}))`;
      const running = await tx.syncRun.findFirst({ where: { kind, integrationId, status: 'RUNNING' } });
      if (running) {
        if (Date.now() - running.startedAt.getTime() < STALE_RUN_MS) return null;
        await tx.syncRun.update({ where: { id: running.id }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'Corrida abandonada (sin terminar en el plazo)' } });
      }
      const run = await tx.syncRun.create({
        data: { kind: kind as SyncKind, integrationId, providerId, status: 'RUNNING', triggeredById: ctx?.userId ?? null, correlationId: ctx?.correlationId ?? null },
        select: { id: true },
      });
      return run.id;
    });
  }

  // ---------------- consultas al proveedor ----------------

  private queriesFor(ctx: Ctx): AvailabilityQuery[] {
    return ctx.kinds.map((kind) => {
      if (kind === 'ROOM') return { kind, startDate: ctx.window.from, endDate: addDaysIso(ctx.window.to, 1), quantity: 1 };
      if (kind === 'FLIGHT') return { kind, startDate: ctx.window.from, endDate: ctx.window.to, quantity: 1 };
      return { kind, startDate: ctx.window.from, quantity: 1 };
    });
  }

  private async fetchAvailability(ctx: Ctx): Promise<CanonicalAvailability[]> {
    const out: CanonicalAvailability[] = [];
    for (const q of this.queriesFor(ctx)) {
      // Los vuelos se piden dia por dia: muchos proveedores limitan el rango de busqueda.
      const queries = q.kind === 'FLIGHT' ? this.days(ctx.window.from, ctx.window.to).map((d) => ({ ...q, startDate: d, endDate: undefined })) : [q];
      for (const one of queries) {
        const r = await this.engine.search(ctx.integrationId, one);
        if (!r.ok) {
          ctx.c.failures.push(`${one.kind} ${one.startDate}: ${r.error.code} ${r.error.message}`);
          continue;
        }
        out.push(...r.data.items);
      }
    }
    return out;
  }

  private days(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
    return out;
  }

  /** Diferencia abierta equivalente: mismo tipo, proveedor, producto/item y, si aplica, misma fecha. */
  private openWhere(ctx: Ctx, kind: InconsistencyKind, ref: { productId?: string; bookingItemId?: string; date?: string }): Prisma.InconsistencyWhereInput {
    return {
      kind, status: 'OPEN', providerId: ctx.providerId, productId: ref.productId ?? null, bookingItemId: ref.bookingItemId ?? null,
      ...(ref.date && { expected: { path: ['date'], equals: ref.date } }),
    };
  }

  /** La diferencia ya no existe en el proveedor: se resuelve sola (queda la nota). */
  private async resolveIfMatches(ctx: Ctx, kind: InconsistencyKind, ref: { productId?: string; bookingItemId?: string; date?: string }): Promise<void> {
    await this.prisma.inconsistency.updateMany({
      where: this.openWhere(ctx, kind, ref),
      data: { status: 'RESOLVED', resolvedAt: new Date(), notes: `Resuelta automaticamente: la sincronizacion ${ctx.runId} ya no encontro la diferencia` },
    });
  }

  private async inconsistency(ctx: Ctx, kind: InconsistencyKind, ref: { productId?: string; bookingItemId?: string; date?: string }, expected: unknown, actual: unknown, notes?: string): Promise<void> {
    const open = await this.prisma.inconsistency.findFirst({ where: this.openWhere(ctx, kind, ref), select: { id: true } });
    if (open) {
      await this.prisma.inconsistency.update({ where: { id: open.id }, data: { expected: toJsonInput(expected), actual: toJsonInput(actual), syncRunId: ctx.runId } });
      return;
    }
    await this.prisma.inconsistency.create({
      data: {
        kind, providerId: ctx.providerId, productId: ref.productId ?? null, bookingItemId: ref.bookingItemId ?? null, syncRunId: ctx.runId,
        expected: toJsonInput(expected), actual: toJsonInput(actual), notes: notes ?? null,
      },
    });
    ctx.c.inconsistencies++;
  }

  // ---------------- CATALOG ----------------

  private async syncCatalog(ctx: Ctx): Promise<void> {
    const items = await this.fetchAvailability(ctx);
    const seen = new Set<string>();
    for (const item of items) {
      const id = item.product.ref.externalId;
      if (seen.has(id)) continue;
      seen.add(id);
      const r = await this.catalog.persistProduct(ctx.providerId, item.product);
      ctx.c.processed++;
      if (r.created || r.changed) ctx.c.changed++;
    }
    if (ctx.c.failures.length > 0) return; // con fallas no se puede afirmar que algo "desaparecio"
    // Habitaciones y planes conocidos que el proveedor ya no ofrece (los vuelos son instancias por fecha).
    const known = await this.prisma.externalReference.findMany({
      where: { providerId: ctx.providerId, entityType: PRODUCT_ENTITY },
      select: { entityId: true, externalId: true },
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: known.map((k) => k.entityId) }, status: 'ACTIVE', type: { in: ctx.kinds.filter((k) => k !== 'FLIGHT') as ProductType[] } },
      select: { id: true, code: true },
    });
    const externalOf = new Map(known.map((k) => [k.entityId, k.externalId]));
    for (const p of products) {
      if (!seen.has(externalOf.get(p.id) ?? p.code)) {
        await this.inconsistency(ctx, 'MISSING_AT_PROVIDER', { productId: p.id }, { externalId: externalOf.get(p.id) }, null, 'El proveedor ya no ofrece el producto');
      }
    }
  }

  // ---------------- AVAILABILITY ----------------

  private async syncAvailability(ctx: Ctx): Promise<void> {
    const items = await this.fetchAvailability(ctx);
    for (const item of items) {
      const persisted = await this.catalog.persistProduct(ctx.providerId, item.product);
      const changed = await this.catalog.recordAvailability(ctx.providerId, persisted.productId, item.date, item.availableQuantity);
      ctx.c.processed++;
      if (changed) ctx.c.changed++;
      // Cupo propio: la base es la fuente de verdad; si el hotel informa otra cosa, se registra la diferencia.
      // Se comparan unidades fisicas (sin el plazo de release, que es una regla de venta propia).
      const local = await this.inventory.remaining(persisted.productId, item.date);
      if (local !== null) {
        const ref = { productId: persisted.productId, date: item.date };
        if (local !== item.availableQuantity) {
          await this.inconsistency(ctx, 'AVAILABILITY_MISMATCH', ref, { date: item.date, available: local }, { date: item.date, available: item.availableQuantity });
        } else {
          await this.resolveIfMatches(ctx, 'AVAILABILITY_MISMATCH', ref);
        }
      }
    }
  }

  // ---------------- RATES ----------------

  private async syncRates(ctx: Ctx): Promise<void> {
    const refs = await this.prisma.externalReference.findMany({ where: { providerId: ctx.providerId, entityType: PRODUCT_ENTITY }, select: { entityId: true, externalId: true } });
    const products = await this.prisma.product.findMany({
      where: { id: { in: refs.map((r) => r.entityId) }, status: 'ACTIVE', type: { in: ctx.kinds as ProductType[] } },
      include: { ProductFlightByProductId: { select: { departureAt: true } } },
    });
    const extOf = new Map(refs.map((r) => [r.entityId, r.externalId]));
    const day = ctx.window.from;
    // Cada vuelo se cotiza en su fecha; habitaciones (1 noche) y planes, en el primer dia de la ventana.
    const groups = new Map<string, { startDate: string; endDate?: string; items: typeof products }>();
    for (const p of products) {
      let key: string;
      let startDate: string;
      let endDate: string | undefined;
      if (p.type === 'FLIGHT') {
        const dep = p.ProductFlightByProductId?.departureAt;
        if (!dep) continue;
        startDate = toIsoDate(dep);
        if (startDate < ctx.window.from || startDate > ctx.window.to) continue;
        key = `F|${startDate}`;
      } else if (p.type === 'ROOM') {
        startDate = day;
        endDate = addDaysIso(day, 1);
        key = 'R';
      } else {
        startDate = day;
        key = 'A';
      }
      const g = groups.get(key) ?? { startDate, endDate, items: [] };
      g.items.push(p);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      for (let i = 0; i < g.items.length; i += RATE_BATCH) {
        const batch = g.items.slice(i, i + RATE_BATCH);
        const query = { products: batch.map((p): ExternalRef => ({ providerCode: ctx.providerCode, externalId: extOf.get(p.id) ?? p.code })), startDate: g.startDate, ...(g.endDate && { endDate: g.endDate }), quantity: 1 };
        const r = await this.engine.getRates(ctx.integrationId, query);
        if (!r.ok) {
          ctx.c.failures.push(`tarifas ${g.startDate}: ${r.error.code} ${r.error.message}`);
          continue;
        }
        for (const rate of r.data.rates) {
          const product = batch.find((p) => (extOf.get(p.id) ?? p.code) === rate.ref.externalId);
          if (!product) continue;
          ctx.c.processed++;
          await this.applyRate(ctx, product.id, product.type as ProductKind, rate.rateCode, rate.total, rate.taxes, rate.validFrom, rate.validTo, rate.providerRateRef);
        }
      }
    }
  }

  private async applyRate(
    ctx: Ctx, productId: string, kind: ProductKind, rateCode: string, total: { amount: string; currency: string }, taxes: { amount: string }, validFrom: string, validTo: string, providerRateRef?: string,
  ): Promise<void> {
    // El proveedor informa el total de la consulta (1 unidad, 1 noche): se guarda como importe + impuestos.
    const amount = fromCents(toCents(total.amount) - toCents(taxes.amount));
    const tax = taxes.amount;
    const isAllotment = (await this.catalog.inventorySource(productId, kind === 'ASSISTANCE_PLAN' ? [] : [validFrom])) === 'ALLOTMENT';
    if (isAllotment) {
      // Tarifa propia contratada: no se pisa; si el proveedor informa otra cosa, se registra la diferencia.
      const local = await this.rates.findApplicable(productId, validFrom, validFrom);
      if (local && (local.amount.toFixed(2) !== amount || local.taxesAmount.toFixed(2) !== tax || local.currency !== total.currency)) {
        await this.inconsistency(ctx, 'RATE_MISMATCH', { productId }, { amount: local.amount.toFixed(2), taxes: local.taxesAmount.toFixed(2), currency: local.currency }, { amount, taxes: tax, currency: total.currency, date: validFrom });
      }
      return;
    }
    const from = new Date(`${validFrom}T00:00:00Z`);
    const to = new Date(`${validTo}T00:00:00Z`);
    const existing = await this.prisma.rate.findFirst({ where: { productId, rateCode, validFrom: from, validTo: to } });
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        const r = await tx.rate.create({ data: { productId, rateCode, currency: total.currency, amount, taxesAmount: tax, validFrom: from, validTo: to, providerRateRef: providerRateRef ?? null } });
        await tx.rateHistory.create({ data: { rateId: r.id, oldAmount: null, newAmount: r.amount, currency: r.currency, reason: `Sincronizacion ${ctx.providerCode}` } });
      });
      ctx.c.changed++;
      return;
    }
    if (existing.amount.toFixed(2) !== amount || existing.taxesAmount.toFixed(2) !== tax) {
      await this.prisma.$transaction(async (tx) => {
        const r = await tx.rate.update({ where: { id: existing.id }, data: { amount, taxesAmount: tax, providerRateRef: providerRateRef ?? existing.providerRateRef, active: true } });
        await tx.rateHistory.create({ data: { rateId: r.id, oldAmount: existing.amount, newAmount: r.amount, currency: r.currency, reason: `Sincronizacion ${ctx.providerCode}` } });
      });
      ctx.c.changed++;
    }
  }

  // ---------------- BOOKINGS ----------------

  private async syncBookings(ctx: Ctx): Promise<void> {
    const items = await this.prisma.bookingItem.findMany({
      where: {
        status: 'CONFIRMED', product: { providerId: ctx.providerId }, externalLocator: { not: null }, NOT: { externalLocator: { startsWith: 'MGT-' } },
        startDate: { gte: new Date(`${addDaysIso(todayIso(), -1)}T00:00:00Z`) }, booking: { status: 'CONFIRMED' },
      },
      include: { booking: { select: { id: true, reference: true } } },
      take: 500,
    });
    for (const item of items) {
      const r = await this.engine.queryBooking(ctx.integrationId, { clientReference: item.id, externalLocator: item.externalLocator! }, item.id);
      if (!r.ok) {
        ctx.c.failures.push(`reserva ${item.booking.reference}: ${r.error.code}`);
        continue;
      }
      ctx.c.processed++;
      const d = r.data;
      if (!d.found) {
        await this.inconsistency(ctx, 'MISSING_AT_PROVIDER', { bookingItemId: item.id, productId: item.productId }, { status: 'CONFIRMED', locator: item.externalLocator }, null, `Reserva ${item.booking.reference}`);
        await this.exceptions.open({ type: 'RECONCILIATION_MISMATCH', severity: 'HIGH', bookingId: item.booking.id, providerId: ctx.providerId, title: `El proveedor no encuentra la reserva ${item.booking.reference}`, description: `Localizador ${item.externalLocator}` });
      } else if (d.status !== 'CONFIRMED') {
        await this.inconsistency(ctx, 'BOOKING_STATUS_MISMATCH', { bookingItemId: item.id, productId: item.productId }, { status: 'CONFIRMED' }, { status: d.status, locator: d.externalLocator });
        await this.exceptions.open({ type: 'RECONCILIATION_MISMATCH', severity: 'HIGH', bookingId: item.booking.id, providerId: ctx.providerId, title: `Estado distinto en el proveedor para ${item.booking.reference}`, description: `Local CONFIRMED, proveedor ${d.status}` });
      }
    }
  }

  // ---------------- consultas ----------------

  async listRuns(q: ListSyncRunsQueryDto) {
    const where: Prisma.SyncRunWhereInput = { ...(q.kind && { kind: q.kind }), ...(q.integrationId && { integrationId: q.integrationId }), ...(q.status && { status: q.status }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.syncRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip: q.skip, take: q.pageSize, include: { provider: { select: { code: true } }, integration: { select: { name: true } } } }),
      this.prisma.syncRun.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }

  async getRun(id: string) {
    const run = await this.prisma.syncRun.findUnique({ where: { id }, include: { inconsistenciesBySyncRunId: true, provider: { select: { code: true } } } });
    if (!run) throw Errors.notFound('SYNC_RUN_NOT_FOUND', 'Corrida no encontrada');
    const { inconsistenciesBySyncRunId, ...rest } = run;
    return { ...rest, inconsistencies: inconsistenciesBySyncRunId };
  }

  async listInconsistencies(q: ListInconsistenciesQueryDto) {
    const where: Prisma.InconsistencyWhereInput = { ...(q.status && { status: q.status }), ...(q.providerId && { providerId: q.providerId }), ...(q.kind && { kind: q.kind }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inconsistency.findMany({ where, orderBy: { detectedAt: 'desc' }, skip: q.skip, take: q.pageSize, include: { product: { select: { id: true, code: true, name: true } }, provider: { select: { code: true } } } }),
      this.prisma.inconsistency.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }

  async closeInconsistency(id: string, dto: CloseInconsistencyDto) {
    const row = await this.prisma.inconsistency.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('INCONSISTENCY_NOT_FOUND', 'Inconsistencia no encontrada');
    if (row.status !== 'OPEN') throw Errors.conflict('INCONSISTENCY_CLOSED', 'La inconsistencia ya esta cerrada');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inconsistency.update({ where: { id }, data: { status: dto.status, notes: dto.notes, resolvedAt: new Date(), resolvedById: getRequestContext()?.userId ?? null } });
      await this.audit.record({ action: `INCONSISTENCY_${dto.status}`, entity: 'inconsistency', entityId: id, after: { notes: dto.notes } }, tx);
      return updated;
    });
  }
}
