import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExceptionType, Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import type { Env } from '../../common/config/env.validation';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { sameMoney } from '../../common/money/money';
import { newReference } from '../../common/references/reference';
import { toIsoDate } from '../../common/time/dates';
import { AvailabilitySource, ConfirmResult, ExternalRef, Money, ProductKind, TravelerData } from '../normalization/canonical';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../catalog/catalog.service';
import { ExceptionsService } from '../exceptions/exceptions.service';
import { EngineResult } from '../integration-engine/engine.types';
import { IntegrationEngine } from '../integration-engine/integration-engine.service';
import { InventoryService, NoAllotmentAvailabilityError } from '../inventory/inventory.service';
import { inventoryDates } from '../pricing/stay';
import { BookingStatusName, confirmationOutcome, ItemStatusName, sourcesOf } from './booking-state';
import { CancelBookingDto, CreateBookingDto, ListBookingsQueryDto } from './dto/bookings.dto';

/** Un item sin confirmar que el proveedor sigue sin conocer tras este tiempo se da por no ejecutado. */
export const RECONCILE_GIVE_UP_MS = 10 * 60_000;
/** Prefijo del localizador propio para cupo confirmado sin integracion con el hotel. */
const INTERNAL_LOCATOR_PREFIX = 'MGT-';

export interface StepError {
  itemId: string;
  code: string;
  message: string;
  transactionId?: string | null;
  outcomeUnknown?: boolean;
}

export interface Outcome {
  status: BookingStatusName;
  errors: StepError[];
  penalties?: Array<{ itemId: string; penalty: Money }>;
}

const include = {
  bookingItemsByBookingId: {
    orderBy: { createdAt: 'asc' },
    include: { product: { select: { id: true, code: true, name: true, type: true, providerId: true, provider: { select: { id: true, code: true, name: true } } } } },
  },
  travelersByBookingId: true,
  bookingStatusHistoryByBookingId: { orderBy: { at: 'asc' } },
  exceptionCasesByBookingId: { select: { id: true, type: true, severity: true, status: true, title: true, createdAt: true } },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof include }>;
type ItemRow = BookingRow['bookingItemsByBookingId'][number];

interface ItemCtx {
  item: ItemRow;
  kind: ProductKind;
  source: AvailabilitySource;
  dates: string[];
  integrationId: string | null;
  ref: ExternalRef;
  caps: { canHold: boolean; canConfirm: boolean; canCancel: boolean; canQueryStatus: boolean };
  expected: Money;
  startDate: string;
  endDate?: string;
}

function exceptionTypeOf(code: string): ExceptionType {
  switch (code) {
    case 'NO_AVAILABILITY': return 'NO_AVAILABILITY';
    case 'PRICE_CHANGED': return 'PRICE_CHANGED';
    case 'TIMEOUT': return 'PROVIDER_TIMEOUT';
    case 'UNAVAILABLE': case 'PROVIDER_NOT_AVAILABLE': return 'PROVIDER_UNAVAILABLE';
    case 'MANUAL_PROVIDER': return 'MANUAL_PROVIDER';
    default: return 'PROVIDER_ERROR';
  }
}

/**
 * Orquestacion de reservas: busqueda -> cotizacion -> reserva -> bloqueo -> confirmacion -> cancelacion.
 * Reglas:
 *  - Cada cambio de estado es un UPDATE condicional sobre el estado actual (dos operaciones simultaneas
 *    sobre la misma reserva no pueden avanzar ambas) y queda en booking_status_history.
 *  - Nunca se mantiene abierta una transaccion de base durante una llamada al proveedor.
 *  - PROVIDER_LIVE se revalida (disponibilidad y precio) antes de confirmar, salvo que haya bloqueo del proveedor.
 *  - Resultado desconocido al confirmar => se consulta al proveedor y se concilia; nunca se asume CONFIRMED.
 *  - Falla parcial => compensacion: se cancelan los items ya confirmados y se libera el cupo.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: IntegrationEngine,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly exceptions: ExceptionsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ================= alta y consulta =================

  async create(dto: CreateBookingDto) {
    const quote = await this.prisma.quote.findUnique({ where: { id: dto.quoteId }, include: { quoteItemsByQuoteId: true } });
    if (!quote) throw Errors.notFound('QUOTE_NOT_FOUND', 'Cotizacion no encontrada');
    if (quote.status === 'CONVERTED') throw Errors.conflict('QUOTE_ALREADY_USED', 'La cotizacion ya se convirtio en una reserva');
    if (quote.status === 'EXPIRED' || quote.expiresAt <= new Date()) throw Errors.conflict('QUOTE_EXPIRED', 'La cotizacion vencio: vuelva a cotizar');
    const userId = getRequestContext()?.userId ?? null;
    const holderFlagged = dto.travelers.some((t) => t.isHolder);

    const booking = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quote.updateMany({ where: { id: quote.id, status: 'OPEN', expiresAt: { gt: new Date() } }, data: { status: 'CONVERTED' } });
      if (claimed.count === 0) throw Errors.conflict('QUOTE_ALREADY_USED', 'La cotizacion ya no esta disponible');
      const b = await tx.booking.create({
        data: {
          reference: newReference('MGT'), quoteId: quote.id, status: 'QUOTED', currency: quote.currency, totalAmount: quote.totalAmount,
          holderName: dto.holderName, holderEmail: dto.holderEmail, createdById: userId,
          bookingItemsByBookingId: {
            create: quote.quoteItemsByQuoteId.map((qi) => ({
              productId: qi.productId, quantity: qi.quantity, startDate: qi.startDate, endDate: qi.endDate,
              unitAmount: qi.unitAmount, totalAmount: qi.unitAmount.mul(qi.quantity), sourceCurrency: qi.sourceCurrency, sourceAmount: qi.sourceAmount,
            })),
          },
          travelersByBookingId: {
            create: dto.travelers.map((t, i) => ({
              firstName: t.firstName, lastName: t.lastName, email: t.email ?? null, documentType: t.documentType ?? null, documentNumber: t.documentNumber ?? null,
              birthDate: t.birthDate ? new Date(`${t.birthDate}T00:00:00Z`) : null, isHolder: holderFlagged ? !!t.isHolder : i === 0,
            })),
          },
        },
      });
      await tx.bookingStatusHistory.create({ data: { bookingId: b.id, fromStatus: null, toStatus: 'QUOTED', reason: `Creada desde la cotizacion ${quote.reference}`, userId, correlationId: getRequestContext()?.correlationId ?? null } });
      await this.audit.record({ action: 'BOOKING_CREATED', entity: 'booking', entityId: b.id, after: { reference: b.reference, quote: quote.reference, total: b.totalAmount.toFixed(2), currency: b.currency } }, tx);
      return b;
    });
    return this.get(booking.id);
  }

  async get(id: string) {
    return this.view(await this.load(id));
  }

  async list(q: ListBookingsQueryDto) {
    const where: Prisma.BookingWhereInput = {
      ...(q.status && { status: q.status }), ...(q.reference && { reference: q.reference }), ...(q.holderEmail && { holderEmail: q.holderEmail.toLowerCase() }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include, orderBy: { requestedAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.booking.count({ where }),
    ]);
    return new PageResult(rows.map((r) => this.view(r)), total, q.page, q.pageSize);
  }

  async transactions(id: string) {
    const b = await this.load(id);
    return this.prisma.integrationTransaction.findMany({
      where: { bookingItemId: { in: b.bookingItemsByBookingId.map((i) => i.id) } },
      orderBy: { startedAt: 'asc' },
      select: { id: true, operation: true, status: true, operationKey: true, attempts: true, durationMs: true, errorCode: true, errorMessage: true, bookingItemId: true, correlationId: true, startedAt: true },
    });
  }

  // ================= bloqueo =================

  async hold(id: string): Promise<{ booking: unknown; outcome: Outcome }> {
    const booking = await this.load(id);
    if (booking.status !== 'QUOTED') throw Errors.conflict('INVALID_BOOKING_STATE', `Solo se bloquea una reserva QUOTED (esta en ${booking.status})`);
    await this.prisma.$transaction((tx) => this.move(tx, id, 'QUOTED', 'HELD', 'Bloqueo de cupo y de proveedor'));

    const ttlMs = this.config.get('HOLD_TTL_MINUTES', { infer: true }) * 60_000;
    const ctxs = await this.contexts(booking);
    // Primero el cupo propio (local y barato): si falla no quedan bloqueos en proveedores.
    ctxs.sort((a, b) => (a.source === b.source ? 0 : a.source === 'ALLOTMENT' ? -1 : 1));
    const errors: StepError[] = [];
    for (const c of ctxs) {
      if (errors.length > 0) break;
      const expiresAt = new Date(Date.now() + ttlMs);
      try {
        if (c.source === 'ALLOTMENT') {
          await this.prisma.$transaction(async (tx) => {
            await this.inventory.hold(tx, { productId: c.item.productId, dates: c.dates, quantity: c.item.quantity, bookingItemId: c.item.id, expiresAt, userId: getRequestContext()?.userId });
            await this.moveItem(tx, c.item.id, ['PENDING'], 'HELD', { holdExpiresAt: expiresAt });
          });
          continue;
        }
        if (!c.integrationId) {
          errors.push({ itemId: c.item.id, code: 'PROVIDER_NOT_AVAILABLE', message: 'El proveedor no tiene integracion habilitada' });
          continue;
        }
        if (c.caps.canHold) {
          const r = await this.engine.hold(c.integrationId, {
            clientReference: c.item.id, product: c.ref, quantity: c.item.quantity, startDate: c.startDate, ...(c.endDate && { endDate: c.endDate }),
            expectedTotal: c.expected, travelers: this.travelers(booking),
          }, `${c.item.id}:HOLD`, c.item.id);
          if (!r.ok) {
            errors.push({ itemId: c.item.id, code: r.error.code, message: r.error.message, transactionId: r.transactionId, outcomeUnknown: r.error.outcomeUnknown });
            continue;
          }
          if (!sameMoney(r.data.confirmedTotal, c.expected)) {
            errors.push({ itemId: c.item.id, code: 'PRICE_CHANGED', message: `El proveedor bloqueo a ${r.data.confirmedTotal.amount} ${r.data.confirmedTotal.currency} (cotizado ${c.expected.amount})`, transactionId: r.transactionId });
            continue;
          }
          const providerExpiry = r.data.expiresAt ? new Date(r.data.expiresAt) : expiresAt;
          await this.prisma.$transaction((tx) => this.moveItem(tx, c.item.id, ['PENDING'], 'HELD', {
            providerHoldRef: r.data.providerHoldRef, holdExpiresAt: providerExpiry < expiresAt ? providerExpiry : expiresAt,
          }));
          continue;
        }
        // Proveedor sin bloqueo previo: se revalida disponibilidad y precio; la reserva firme llega al confirmar.
        const check = await this.revalidateLive(c);
        if (check) {
          errors.push(check);
          continue;
        }
        await this.prisma.$transaction((tx) => this.moveItem(tx, c.item.id, ['PENDING'], 'HELD', { holdExpiresAt: expiresAt }));
      } catch (e) {
        if (e instanceof NoAllotmentAvailabilityError) {
          errors.push({ itemId: c.item.id, code: 'NO_AVAILABILITY', message: `Sin cupo propio disponible el ${e.date}` });
          continue;
        }
        throw e;
      }
    }

    if (errors.length > 0) {
      await this.fail(id, 'HELD', errors, 'No se pudo bloquear');
    } else {
      await this.audit.record({ action: 'BOOKING_HELD', entity: 'booking', entityId: id });
    }
    const after = await this.load(id);
    return { booking: this.view(after), outcome: { status: after.status as BookingStatusName, errors } };
  }

  // ================= confirmacion =================

  async confirm(id: string): Promise<{ booking: unknown; outcome: Outcome }> {
    const booking = await this.load(id);
    if (booking.status !== 'HELD') throw Errors.conflict('INVALID_BOOKING_STATE', `Solo se confirma una reserva HELD (esta en ${booking.status})`);
    const now = new Date();
    if (booking.bookingItemsByBookingId.some((i) => i.holdExpiresAt && i.holdExpiresAt <= now)) {
      await this.expireBooking(id);
      throw Errors.conflict('HOLD_EXPIRED', 'El bloqueo vencio: la reserva expiro y el cupo se libero');
    }
    await this.prisma.$transaction((tx) => this.move(tx, id, 'HELD', 'PENDING_CONFIRMATION', 'Confirmacion solicitada al proveedor'));

    const ctxs = await this.contexts(booking);
    // Primero lo que depende de terceros; el cupo propio es local y casi nunca falla: menos compensaciones.
    ctxs.sort((a, b) => (a.source === b.source ? 0 : a.source === 'PROVIDER_LIVE' ? -1 : 1));
    const errors: StepError[] = [];
    for (const c of ctxs) {
      if (errors.length > 0) {
        // Ya hubo una falla definitiva: lo que no se envio no se envia.
        await this.prisma.$transaction((tx) => this.moveItem(tx, c.item.id, ['HELD'], 'FAILED'));
        continue;
      }
      await this.prisma.$transaction((tx) => this.moveItem(tx, c.item.id, ['HELD'], 'PENDING_CONFIRMATION'));
      const err = await this.confirmItem(booking, c);
      if (err) errors.push(err);
    }
    const outcome = await this.finalize(id, errors);
    return { booking: this.view(await this.load(id)), outcome };
  }

  /** Confirma un item. Devuelve un error solo si fallo de forma definitiva (nada quedo en el proveedor). */
  private async confirmItem(booking: BookingRow, c: ItemCtx): Promise<StepError | null> {
    const failItem = async (e: StepError) => {
      await this.prisma.$transaction((tx) => this.moveItem(tx, c.item.id, ['PENDING_CONFIRMATION'], 'FAILED'));
      return e;
    };

    if (c.source === 'ALLOTMENT' && (!c.integrationId || !c.caps.canConfirm)) {
      // Cupo propio sin integracion con el hotel: la base es la fuente de verdad y el localizador es propio.
      const idx = booking.bookingItemsByBookingId.findIndex((i) => i.id === c.item.id) + 1;
      await this.markConfirmed(c, `${INTERNAL_LOCATOR_PREFIX}${booking.reference}-${idx}`);
      return null;
    }
    if (!c.integrationId) return failItem({ itemId: c.item.id, code: 'PROVIDER_NOT_AVAILABLE', message: 'El proveedor no tiene integracion habilitada' });
    if (!c.caps.canConfirm) return failItem({ itemId: c.item.id, code: 'MANUAL_PROVIDER', message: 'El proveedor no admite confirmacion automatica' });

    if (c.source === 'PROVIDER_LIVE' && !c.item.providerHoldRef) {
      const check = await this.revalidateLive(c);
      if (check) return failItem(check);
    }

    const r = await this.engine.confirm(c.integrationId, {
      clientReference: c.item.id, ...(c.item.providerHoldRef && { providerHoldRef: c.item.providerHoldRef }), product: c.ref, quantity: c.item.quantity,
      startDate: c.startDate, ...(c.endDate && { endDate: c.endDate }), expectedTotal: c.expected, travelers: this.travelers(booking),
    }, `${c.item.id}:CONFIRM`, c.item.id);
    return this.applyConfirmResult(booking, c, r);
  }

  private async applyConfirmResult(booking: BookingRow, c: ItemCtx, r: EngineResult<ConfirmResult>): Promise<StepError | null> {
    const itemId = c.item.id;
    if (r.ok) {
      const d = r.data;
      if (d.status === 'CONFIRMED' && d.externalLocator) {
        if (d.confirmedTotal && !sameMoney(d.confirmedTotal, c.expected)) {
          await this.exceptions.open({
            type: 'PRICE_CHANGED', severity: 'HIGH', bookingId: booking.id, transactionId: r.transactionId, providerId: c.item.product.providerId,
            title: `El proveedor confirmo ${booking.reference} a otro precio`, description: `Esperado ${c.expected.amount} ${c.expected.currency}, confirmado ${d.confirmedTotal.amount} ${d.confirmedTotal.currency}`,
          });
        }
        await this.markConfirmed(c, d.externalLocator);
        return null;
      }
      if (d.status === 'PENDING_CONFIRMATION' || d.status === 'HELD') {
        if (d.externalLocator) await this.prisma.bookingItem.update({ where: { id: itemId }, data: { externalLocator: d.externalLocator, providerBookingRef: d.externalLocator } });
        return null; // confirmacion a pedido: la concilia el trabajo de conciliacion
      }
      if (d.status === 'REJECTED' || d.status === 'CANCELLED') {
        await this.prisma.$transaction((tx) => this.moveItem(tx, itemId, ['PENDING_CONFIRMATION'], 'FAILED'));
        return { itemId, code: 'REJECTED', message: `El proveedor rechazo la confirmacion (${d.providerStatusRaw ?? d.status})`, transactionId: r.transactionId };
      }
      // UNKNOWN informado por el proveedor: igual que un timeout.
    } else {
      const e = r.error;
      if (e.engineCode === 'OPERATION_IN_PROGRESS') return null;
      if (!e.outcomeUnknown) {
        await this.prisma.$transaction((tx) => this.moveItem(tx, itemId, ['PENDING_CONFIRMATION'], 'FAILED'));
        return { itemId, code: e.code, message: e.message, transactionId: r.transactionId };
      }
    }

    // Resultado DESCONOCIDO: el proveedor pudo haber confirmado. Se consulta antes de decidir.
    const status = await this.reconcileItem(itemId, { finalize: false });
    if (status === 'PENDING_CONFIRMATION') {
      await this.exceptions.open({
        type: 'PROVIDER_TIMEOUT', severity: 'MEDIUM', bookingId: booking.id, transactionId: r.transactionId, providerId: c.item.product.providerId,
        title: `Confirmacion con resultado desconocido en ${booking.reference}`,
        description: 'El proveedor no respondio a tiempo. El item queda pendiente y se concilia automaticamente consultando al proveedor; no se reenvia la confirmacion.',
      });
    }
    if (status === 'FAILED') return { itemId, code: 'REJECTED', message: 'El proveedor informo que la reserva no se concreto', transactionId: r.transactionId };
    return null;
  }

  private async markConfirmed(c: ItemCtx, locator: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const moved = await this.moveItem(tx, c.item.id, ['PENDING_CONFIRMATION', 'REQUIRES_REVIEW'], 'CONFIRMED', {
        externalLocator: locator, providerBookingRef: locator, confirmedAt: new Date(),
      });
      if (moved && c.source === 'ALLOTMENT') await this.inventory.consume(tx, c.item.id, getRequestContext()?.userId);
    });
  }

  /**
   * Decide el estado de la reserva a partir de sus items. Se llama al terminar de confirmar y cada vez que
   * la conciliacion resuelve un item pendiente.
   */
  async finalize(bookingId: string, errors: StepError[]): Promise<Outcome> {
    const b = await this.load(bookingId);
    const statuses = b.bookingItemsByBookingId.map((i) => i.status as ItemStatusName);
    const next = confirmationOutcome(statuses);
    if (b.status !== 'PENDING_CONFIRMATION' && b.status !== 'REQUIRES_REVIEW') return { status: b.status as BookingStatusName, errors };

    if (next === 'CONFIRMED') {
      await this.prisma.$transaction((tx) => this.move(tx, bookingId, b.status as BookingStatusName, 'CONFIRMED', 'Todos los items confirmados por el proveedor', { confirmedAt: new Date() }));
      await this.audit.record({ action: 'BOOKING_CONFIRMED', entity: 'booking', entityId: bookingId, after: { reference: b.reference } });
      return { status: 'CONFIRMED', errors };
    }
    if (next === 'FAILED') {
      await this.fail(bookingId, b.status as BookingStatusName, errors, 'No se pudo confirmar');
      return { status: 'FAILED', errors };
    }
    if (next === 'COMPENSATING') return this.compensate(bookingId, b.status as BookingStatusName, errors);
    if (next === 'REQUIRES_REVIEW' && b.status !== 'REQUIRES_REVIEW') {
      await this.prisma.$transaction((tx) => this.move(tx, bookingId, b.status as BookingStatusName, 'REQUIRES_REVIEW', 'Items en revision'));
      await this.exceptions.open({ type: 'RECONCILIATION_MISMATCH', severity: 'HIGH', bookingId, title: `Reserva ${b.reference} requiere revision`, description: this.describe(errors) });
      return { status: 'REQUIRES_REVIEW', errors };
    }
    return { status: b.status as BookingStatusName, errors };
  }

  /** Falla parcial: se cancelan los items comprometidos y se libera el cupo. */
  private async compensate(bookingId: string, from: BookingStatusName, errors: StepError[]): Promise<Outcome> {
    await this.prisma.$transaction((tx) => this.move(tx, bookingId, from, 'COMPENSATING', `Falla parcial: ${this.describe(errors)}`));
    const b = await this.load(bookingId);
    const ctxs = await this.contexts(b);
    const pending: StepError[] = [];
    for (const c of ctxs) {
      const s = c.item.status as ItemStatusName;
      if (s === 'CONFIRMED' || ((s === 'PENDING_CONFIRMATION' || s === 'REQUIRES_REVIEW') && c.item.externalLocator)) {
        const r = await this.cancelItem(b, c, 'Compensacion por falla parcial de la reserva');
        if (!r.ok) pending.push(r.error);
      } else if (s === 'PENDING_CONFIRMATION' || s === 'REQUIRES_REVIEW') {
        pending.push({ itemId: c.item.id, code: 'UNKNOWN', message: 'Item con resultado desconocido y sin localizador: no se puede compensar automaticamente', outcomeUnknown: true });
      } else {
        await this.prisma.$transaction((tx) => this.inventory.release(tx, c.item.id, 'RELEASE'));
      }
    }
    if (pending.length === 0) {
      await this.prisma.$transaction((tx) => this.move(tx, bookingId, 'COMPENSATING', 'FAILED', 'Compensacion completa: se cancelaron los items confirmados'));
      await this.exceptions.open({
        type: 'PARTIAL_CONFIRMATION', severity: 'MEDIUM', bookingId, providerId: b.bookingItemsByBookingId[0]?.product.providerId,
        title: `Reserva ${b.reference} fallo parcialmente y se compenso`, description: this.describe(errors),
      });
      return { status: 'FAILED', errors };
    }
    await this.prisma.$transaction((tx) => this.move(tx, bookingId, 'COMPENSATING', 'REQUIRES_REVIEW', 'Compensacion incompleta'));
    await this.exceptions.open({
      type: 'CANCELLATION_FAILED', severity: 'HIGH', bookingId, title: `Compensacion incompleta en ${b.reference}`,
      description: `No se pudieron deshacer todos los items: ${this.describe(pending)}. Falla original: ${this.describe(errors)}`,
    });
    return { status: 'REQUIRES_REVIEW', errors: [...errors, ...pending] };
  }

  // ================= cancelacion =================

  async cancel(id: string, dto: CancelBookingDto): Promise<{ booking: unknown; outcome: Outcome }> {
    const booking = await this.load(id);
    if (booking.status !== 'CONFIRMED') throw Errors.conflict('INVALID_BOOKING_STATE', `Solo se cancela una reserva CONFIRMED (esta en ${booking.status})`);
    await this.prisma.$transaction((tx) => this.move(tx, id, 'CONFIRMED', 'CANCEL_REQUESTED', dto.reason));
    const ctxs = await this.contexts(booking);
    const errors: StepError[] = [];
    const penalties: Array<{ itemId: string; penalty: Money }> = [];
    for (const c of ctxs) {
      await this.prisma.$transaction((tx) => this.moveItem(tx, c.item.id, ['CONFIRMED'], 'CANCEL_REQUESTED'));
      const r = await this.cancelItem(booking, c, dto.reason);
      if (!r.ok) errors.push(r.error);
      else if (r.penalty) penalties.push({ itemId: c.item.id, penalty: r.penalty });
    }
    if (errors.length === 0) {
      const note = penalties.length ? ` Penalidades: ${penalties.map((p) => `${p.penalty.amount} ${p.penalty.currency}`).join(', ')}` : '';
      await this.prisma.$transaction((tx) => this.move(tx, id, 'CANCEL_REQUESTED', 'CANCELLED', `${dto.reason}.${note}`, { cancelledAt: new Date() }));
      await this.audit.record({ action: 'BOOKING_CANCELLED', entity: 'booking', entityId: id, after: { reason: dto.reason, penalties } });
    } else {
      await this.prisma.$transaction((tx) => this.move(tx, id, 'CANCEL_REQUESTED', 'REQUIRES_REVIEW', 'Cancelacion incompleta'));
      await this.exceptions.open({
        type: 'CANCELLATION_FAILED', severity: 'HIGH', bookingId: id, title: `Cancelacion incompleta de ${booking.reference}`, description: this.describe(errors),
      });
    }
    const after = await this.load(id);
    return { booking: this.view(after), outcome: { status: after.status as BookingStatusName, errors, penalties } };
  }

  private async cancelItem(booking: BookingRow, c: ItemCtx, reason: string): Promise<{ ok: true; penalty?: Money } | { ok: false; error: StepError }> {
    const itemId = c.item.id;
    const finish = async () => {
      await this.prisma.$transaction(async (tx) => {
        await this.moveItem(tx, itemId, ['CONFIRMED', 'CANCEL_REQUESTED', 'PENDING_CONFIRMATION', 'REQUIRES_REVIEW'], 'CANCELLED');
        await this.inventory.release(tx, itemId, 'RELEASE');
        await this.inventory.returnSold(tx, itemId, getRequestContext()?.userId);
      });
    };
    const locator = c.item.externalLocator;
    if (c.source === 'ALLOTMENT' && (!locator || locator.startsWith(INTERNAL_LOCATOR_PREFIX))) {
      await finish();
      return { ok: true };
    }
    if (!locator) return { ok: false, error: { itemId, code: 'UNKNOWN', message: 'Item sin localizador del proveedor' } };
    if (!c.integrationId) return { ok: false, error: { itemId, code: 'PROVIDER_NOT_AVAILABLE', message: 'El proveedor no tiene integracion habilitada' } };
    if (!c.caps.canCancel) return { ok: false, error: { itemId, code: 'MANUAL_PROVIDER', message: 'El proveedor no admite cancelacion automatica: cancelar manualmente' } };

    const r = await this.engine.cancel(c.integrationId, { clientReference: itemId, externalLocator: locator, reason }, `${itemId}:CANCEL`, itemId);
    if (r.ok && r.data.status === 'CANCELLED') {
      await finish();
      return { ok: true, ...(r.data.penalty && { penalty: r.data.penalty }) };
    }
    if (r.ok) return { ok: false, error: { itemId, code: r.data.status, message: `El proveedor informo ${r.data.status} para la cancelacion`, transactionId: r.transactionId } };
    return { ok: false, error: { itemId, code: r.error.code, message: r.error.message, transactionId: r.transactionId, outcomeUnknown: r.error.outcomeUnknown } };
  }

  // ================= conciliacion =================

  /**
   * Consulta al proveedor el estado real de un item pendiente y lo concilia. Nunca reenvia la confirmacion.
   * Devuelve el estado del item resultante.
   */
  async reconcileItem(itemId: string, opts: { finalize?: boolean } = {}): Promise<ItemStatusName> {
    const item = await this.prisma.bookingItem.findUnique({ where: { id: itemId }, include: { booking: { include } } });
    if (!item) throw Errors.notFound('BOOKING_ITEM_NOT_FOUND', 'Item no encontrado');
    const status = item.status as ItemStatusName;
    if (status !== 'PENDING_CONFIRMATION' && status !== 'REQUIRES_REVIEW') return status;
    const [c] = await this.contexts(item.booking, [itemId]);
    if (!c?.integrationId) return status;

    const q = await this.engine.queryBooking(c.integrationId, { clientReference: itemId, ...(c.item.externalLocator && { externalLocator: c.item.externalLocator }) }, itemId);
    let result: ItemStatusName = status;
    if (q.ok) {
      const d = q.data;
      if (d.found && d.status === 'CONFIRMED' && d.externalLocator) {
        await this.markConfirmed(c, d.externalLocator);
        result = 'CONFIRMED';
      } else if (d.found && (d.status === 'REJECTED' || d.status === 'CANCELLED')) {
        await this.prisma.$transaction((tx) => this.moveItem(tx, itemId, ['PENDING_CONFIRMATION', 'REQUIRES_REVIEW'], 'FAILED'));
        result = 'FAILED';
      } else if (d.found && d.externalLocator && !c.item.externalLocator) {
        await this.prisma.bookingItem.update({ where: { id: itemId }, data: { externalLocator: d.externalLocator, providerBookingRef: d.externalLocator } });
      } else if (!d.found && Date.now() - item.updatedAt.getTime() > RECONCILE_GIVE_UP_MS) {
        // El proveedor sigue sin conocer la reserva mucho despues del intento: no se ejecuto.
        await this.prisma.$transaction((tx) => this.moveItem(tx, itemId, ['PENDING_CONFIRMATION', 'REQUIRES_REVIEW'], 'FAILED'));
        result = 'FAILED';
      }
    }
    if (opts.finalize !== false && result !== status) {
      await this.finalize(item.bookingId, result === 'FAILED' ? [{ itemId, code: 'REJECTED', message: 'El proveedor no concreto la reserva' }] : []);
    }
    return result;
  }

  /** Concilia todos los items pendientes de una reserva (accion manual del operador). */
  async reconcileBooking(id: string) {
    const b = await this.load(id);
    for (const i of b.bookingItemsByBookingId) {
      if (i.status === 'PENDING_CONFIRMATION' || i.status === 'REQUIRES_REVIEW') await this.reconcileItem(i.id);
    }
    return this.get(id);
  }

  // ================= vencimientos =================

  /** Reserva HELD cuyo bloqueo vencio: EXPIRED, se libera el cupo. No hace nada si otra operacion la avanzo. */
  async expireBooking(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id }, include: { bookingItemsByBookingId: true } });
      if (!b || b.status !== 'HELD') return false;
      await this.move(tx, id, 'HELD', 'EXPIRED', 'Vencio el bloqueo');
      for (const i of b.bookingItemsByBookingId) {
        await this.inventory.release(tx, i.id, 'EXPIRE');
        await this.moveItem(tx, i.id, ['PENDING', 'HELD'], 'FAILED');
      }
      return true;
    });
  }

  /** Trabajo periodico: vence bloqueos y reservas QUOTED abandonadas; libera bloqueos de cupo huerfanos. */
  async expireDue(): Promise<{ expiredHeld: number; expiredQuoted: number; orphanHolds: number }> {
    const now = new Date();
    const held = await this.prisma.booking.findMany({ where: { status: 'HELD', bookingItemsByBookingId: { some: { holdExpiresAt: { lte: now } } } }, select: { id: true } });
    let expiredHeld = 0;
    for (const b of held) if (await this.expireBooking(b.id)) expiredHeld++;

    const quoteTtl = this.config.get('QUOTE_TTL_MINUTES', { infer: true }) * 60_000;
    const quoted = await this.prisma.booking.findMany({ where: { status: 'QUOTED', requestedAt: { lt: new Date(now.getTime() - quoteTtl) } }, select: { id: true } });
    let expiredQuoted = 0;
    for (const b of quoted) {
      const ok = await this.prisma.$transaction(async (tx) => {
        const r = await tx.booking.updateMany({ where: { id: b.id, status: 'QUOTED' }, data: { status: 'EXPIRED' } });
        if (r.count === 0) return false;
        await tx.bookingStatusHistory.create({ data: { bookingId: b.id, fromStatus: 'QUOTED', toStatus: 'EXPIRED', reason: 'No se bloqueo a tiempo' } });
        await tx.bookingItem.updateMany({ where: { bookingId: b.id, status: 'PENDING' }, data: { status: 'FAILED' } });
        return true;
      });
      if (ok) expiredQuoted++;
    }

    const orphans = await this.prisma.inventoryHold.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now }, bookingItem: { booking: { status: { notIn: ['HELD', 'PENDING_CONFIRMATION', 'REQUIRES_REVIEW', 'COMPENSATING'] } } } },
      select: { bookingItemId: true }, distinct: ['bookingItemId'],
    });
    let orphanHolds = 0;
    for (const o of orphans) if (o.bookingItemId) orphanHolds += await this.prisma.$transaction((tx) => this.inventory.release(tx, o.bookingItemId!, 'EXPIRE'));
    return { expiredHeld, expiredQuoted, orphanHolds };
  }

  /** Items a conciliar por el trabajo periodico. */
  pendingItems(olderThanMs: number) {
    return this.prisma.bookingItem.findMany({
      where: { status: { in: ['PENDING_CONFIRMATION', 'REQUIRES_REVIEW'] }, updatedAt: { lt: new Date(Date.now() - olderThanMs) }, booking: { status: { in: ['PENDING_CONFIRMATION', 'REQUIRES_REVIEW'] } } },
      select: { id: true }, take: 200,
    });
  }

  // ================= internos =================

  private async fail(bookingId: string, from: BookingStatusName, errors: StepError[], verb: string): Promise<void> {
    const b = await this.load(bookingId);
    await this.prisma.$transaction(async (tx) => {
      for (const i of b.bookingItemsByBookingId) {
        await this.inventory.release(tx, i.id, 'RELEASE');
        await this.moveItem(tx, i.id, ['PENDING', 'HELD', 'PENDING_CONFIRMATION'], 'FAILED');
      }
      await this.move(tx, bookingId, from, 'FAILED', `${verb}: ${this.describe(errors)}`);
    });
    const first = errors[0];
    const leftAtProvider = b.bookingItemsByBookingId.some((i) => i.providerHoldRef);
    await this.exceptions.open({
      type: exceptionTypeOf(first?.code ?? 'UNKNOWN'), severity: first?.outcomeUnknown ? 'MEDIUM' : 'LOW', bookingId, transactionId: first?.transactionId ?? null,
      providerId: b.bookingItemsByBookingId.find((i) => i.id === first?.itemId)?.product.providerId ?? null,
      title: `${verb} la reserva ${b.reference}`,
      description: `${this.describe(errors)}${leftAtProvider ? ' Los bloqueos ya hechos en proveedores vencen solos en el proveedor.' : ''}`,
    });
  }

  private describe(errors: StepError[]): string {
    return errors.length ? errors.map((e) => `[${e.code}] ${e.message}`).join('; ') : 'sin detalle';
  }

  /** Revalida con el proveedor disponibilidad y precio de un item PROVIDER_LIVE. Devuelve el error o null. */
  private async revalidateLive(c: ItemCtx): Promise<StepError | null> {
    const itemId = c.item.id;
    const s = await this.engine.search(c.integrationId!, {
      kind: c.kind, startDate: c.startDate, ...(c.endDate && { endDate: c.endDate }), quantity: c.item.quantity,
    }, itemId);
    if (!s.ok) return { itemId, code: s.error.code, message: `No se pudo revalidar la disponibilidad: ${s.error.message}`, transactionId: s.transactionId };
    const found = s.data.items.filter((i) => i.product.ref.externalId === c.ref.externalId);
    const needed = c.dates.length > 0 ? c.dates : [c.startDate];
    const enough = needed.every((d) => found.some((f) => f.date === d && f.availableQuantity >= c.item.quantity));
    if (!enough) return { itemId, code: 'NO_AVAILABILITY', message: 'El proveedor ya no tiene disponibilidad', transactionId: s.transactionId };

    const r = await this.engine.getRates(c.integrationId!, { products: [c.ref], startDate: c.startDate, ...(c.endDate && { endDate: c.endDate }), quantity: c.item.quantity }, itemId);
    if (!r.ok) return { itemId, code: r.error.code, message: `No se pudo revalidar el precio: ${r.error.message}`, transactionId: r.transactionId };
    const rate = r.data.rates.find((x) => x.ref.externalId === c.ref.externalId);
    if (!rate) return { itemId, code: 'NO_AVAILABILITY', message: 'El proveedor ya no ofrece tarifa', transactionId: r.transactionId };
    if (!sameMoney(rate.total, c.expected)) {
      return { itemId, code: 'PRICE_CHANGED', message: `El precio cambio: cotizado ${c.expected.amount} ${c.expected.currency}, vigente ${rate.total.amount} ${rate.total.currency}`, transactionId: r.transactionId };
    }
    return null;
  }

  private async contexts(b: BookingRow, onlyItemIds?: string[]): Promise<ItemCtx[]> {
    const out: ItemCtx[] = [];
    const fresh = await this.prisma.bookingItem.findMany({
      where: { bookingId: b.id, ...(onlyItemIds && { id: { in: onlyItemIds } }) },
      include: include.bookingItemsByBookingId.include,
      orderBy: { createdAt: 'asc' },
    });
    for (const item of fresh) {
      const kind = item.product.type as ProductKind;
      const startDate = toIsoDate(item.startDate);
      const endDate = item.endDate ? toIsoDate(item.endDate) : undefined;
      const dates = inventoryDates(kind, startDate, endDate);
      const holds = await this.prisma.inventoryHold.count({ where: { bookingItemId: item.id } });
      const source: AvailabilitySource = holds > 0 ? 'ALLOTMENT' : await this.catalog.inventorySource(item.productId, dates);
      const integration = await this.engine.resolveForProvider(item.product.providerId);
      const svc = await this.prisma.providerService.findUnique({ where: { providerId_serviceType: { providerId: item.product.providerId, serviceType: item.product.type } } });
      if (!item.sourceCurrency || !item.sourceAmount) throw Errors.unprocessable('ITEM_WITHOUT_PRICE', 'El item no tiene precio de origen');
      out.push({
        item, kind, source, dates, startDate, endDate, integrationId: integration?.id ?? null, ref: await this.catalog.externalRefFor(item.productId),
        caps: { canHold: svc?.canHold ?? false, canConfirm: svc?.canConfirm ?? true, canCancel: svc?.canCancel ?? true, canQueryStatus: svc?.canQueryStatus ?? true },
        expected: { amount: item.sourceAmount.toFixed(2), currency: item.sourceCurrency },
      });
    }
    return out;
  }

  private travelers(b: BookingRow): TravelerData[] {
    return b.travelersByBookingId.map((t) => ({
      firstName: t.firstName, lastName: t.lastName, ...(t.email && { email: t.email }), ...(t.documentType && { documentType: t.documentType }),
      ...(t.documentNumber && { documentNumber: t.documentNumber }), ...(t.birthDate && { birthDate: toIsoDate(t.birthDate) }),
    }));
  }

  /** Transicion de estado condicional (CAS) + historial. 409 si la reserva ya no esta en el estado esperado. */
  private async move(tx: PrismaTx, bookingId: string, from: BookingStatusName, to: BookingStatusName, reason: string, extra: Prisma.BookingUpdateManyMutationInput = {}): Promise<void> {
    if (!sourcesOf(to).includes(from)) throw new Error(`Transicion invalida ${from} -> ${to}`);
    const r = await tx.booking.updateMany({ where: { id: bookingId, status: from }, data: { status: to, ...extra } });
    if (r.count === 0) throw Errors.conflict('INVALID_BOOKING_STATE', `La reserva ya no esta en ${from} (otra operacion la modifico)`);
    const ctx = getRequestContext();
    await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: from, toStatus: to, reason: reason.slice(0, 2000), userId: ctx?.userId ?? null, correlationId: ctx?.correlationId ?? null } });
  }

  private async moveItem(tx: PrismaTx, itemId: string, from: ItemStatusName[], to: ItemStatusName, data: Prisma.BookingItemUpdateManyMutationInput = {}): Promise<boolean> {
    const r = await tx.bookingItem.updateMany({ where: { id: itemId, status: { in: from } }, data: { status: to, ...data } });
    return r.count === 1;
  }

  private async load(id: string): Promise<BookingRow> {
    const b = await this.prisma.booking.findUnique({ where: { id }, include });
    if (!b) throw Errors.notFound('BOOKING_NOT_FOUND', 'Reserva no encontrada');
    return b;
  }

  private view(b: BookingRow) {
    const holdExpiries = b.bookingItemsByBookingId.map((i) => i.holdExpiresAt).filter((d): d is Date => !!d);
    return {
      id: b.id, reference: b.reference, status: b.status, currency: b.currency, totalAmount: b.totalAmount.toFixed(2),
      holder: { name: b.holderName, email: b.holderEmail }, quoteId: b.quoteId, requestedAt: b.requestedAt, confirmedAt: b.confirmedAt, cancelledAt: b.cancelledAt,
      holdExpiresAt: holdExpiries.length ? new Date(Math.min(...holdExpiries.map((d) => d.getTime()))) : null,
      items: b.bookingItemsByBookingId.map((i: ItemRow) => ({
        id: i.id, status: i.status, product: i.product, quantity: i.quantity, startDate: toIsoDate(i.startDate), endDate: i.endDate ? toIsoDate(i.endDate) : null,
        unitAmount: i.unitAmount.toFixed(2), totalAmount: i.totalAmount.toFixed(2), source: { currency: i.sourceCurrency, amount: i.sourceAmount?.toFixed(2) ?? null },
        externalLocator: i.externalLocator, providerHoldRef: i.providerHoldRef, holdExpiresAt: i.holdExpiresAt, confirmedAt: i.confirmedAt,
      })),
      travelers: b.travelersByBookingId.map((t) => ({
        id: t.id, firstName: t.firstName, lastName: t.lastName, email: t.email, documentType: t.documentType,
        // El documento se muestra enmascarado: solo los ultimos 3 caracteres.
        documentNumber: t.documentNumber ? `${'*'.repeat(Math.max(0, t.documentNumber.length - 3))}${t.documentNumber.slice(-3)}` : null,
        birthDate: t.birthDate ? toIsoDate(t.birthDate) : null, isHolder: t.isHolder,
      })),
      history: b.bookingStatusHistoryByBookingId.map((h) => ({ from: h.fromStatus, to: h.toStatus, reason: h.reason, at: h.at, userId: h.userId, correlationId: h.correlationId })),
      exceptions: b.exceptionCasesByBookingId,
    };
  }
}
