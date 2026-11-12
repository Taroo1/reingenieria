import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { fromCents, sameMoney } from '../../../common/money/money';
import { addDaysIso, diffDaysIso, isIsoDate, nightsOf, todayIso } from '../../../common/time/dates';
import {
  AvailabilityQuery, AvailabilityResult, CanonicalAvailability, CanonicalRate, CancelRequest, CancelResult,
  ConfirmRequest, ConfirmResult, HoldRequest, HoldResult, Money, QueryBookingRequest, QueryBookingResult, RateQuery, RateResult,
} from '../../normalization/canonical';
import { adapterError, fail, ok } from '../adapter-errors';
import { AdapterCallContext, AdapterResult, HealthCheckData, ProviderAdapter } from '../ports/provider-adapter.port';
import {
  catalogFor, flightExternalId, flightProduct, planProduct, roomProduct, SIM_HORIZON_DAYS, SIM_ROOM_TAX_RATE, SIM_UNLIMITED,
  SimCatalog, SimFlightDef, SimPlanDef, SimRoomDef,
} from './simulated-catalog';

const HOLD_TTL_MS = 15 * 60_000;

type Resolved =
  | { type: 'flight'; def: SimFlightDef; date: string }
  | { type: 'room'; def: SimRoomDef }
  | { type: 'plan'; def: SimPlanDef };

interface SimHold {
  ref: string;
  clientReference: string;
  externalId: string;
  dates: string[];
  quantity: number;
  total: Money;
  expiresAt: number;
  status: 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
}

interface SimBooking {
  locator: string;
  clientReference: string;
  externalId: string;
  dates: string[];
  quantity: number;
  total: Money;
  status: 'CONFIRMED' | 'CANCELLED';
}

interface ProviderStore {
  catalog: SimCatalog;
  inventory: Map<string, number>;
  holds: Map<string, SimHold>;
  bookings: Map<string, SimBooking>;
}

/**
 * Adaptador SIMULATED: proveedor ficticio en memoria del proceso, sin red. Determinista y confiable
 * (las fallas se prueban con el adaptador HTTP contra provider-simulator). Deduplica por clientReference.
 * Su estado se pierde al reiniciar el proceso: es para desarrollo, demos y pruebas, no para produccion.
 */
@Injectable()
export class SimulatedAdapter implements ProviderAdapter {
  readonly kind = 'SIMULATED' as const;
  private readonly stores = new Map<string, ProviderStore>();

  /** Reloj (sobrescribible en pruebas). */
  protected now(): number {
    return Date.now();
  }

  private store(ctx: AdapterCallContext): ProviderStore {
    const code = ctx.provider.providerCode;
    let s = this.stores.get(code);
    if (!s) {
      s = { catalog: catalogFor(code, ctx.provider.providerType), inventory: new Map(), holds: new Map(), bookings: new Map() };
      this.stores.set(code, s);
    }
    return s;
  }

  private resolve(s: SimCatalog, externalId: string): Resolved | null {
    const m = /^(.+)-(\d{4})(\d{2})(\d{2})$/.exec(externalId);
    if (m) {
      const def = s.flights.find((f) => f.number === m[1]);
      const date = `${m[2]}-${m[3]}-${m[4]}`;
      if (def && isIsoDate(date)) {
        const offset = diffDaysIso(todayIso(this.now()), date);
        if (offset >= 0 && offset < SIM_HORIZON_DAYS) return { type: 'flight', def, date };
      }
    }
    const room = s.rooms.find((r) => r.code === externalId);
    if (room) return { type: 'room', def: room };
    const plan = s.plans.find((p) => p.code === externalId);
    if (plan) return { type: 'plan', def: plan };
    return null;
  }

  private dates(r: Resolved, start: string, end?: string): string[] | { error: string } {
    if (r.type === 'flight') return start === r.date ? [r.date] : { error: 'startDate no coincide con la fecha del vuelo' };
    if (r.type === 'room') {
      const to = end ?? addDaysIso(start, 1);
      const nights = nightsOf(start, to);
      return nights.length >= 1 && nights.length <= 30 ? nights : { error: 'la estadia debe tener entre 1 y 30 noches' };
    }
    const days = end ? diffDaysIso(start, end) + 1 : 1;
    return days >= 1 && days <= r.def.maxDays ? [] : { error: `el plan cubre como maximo ${r.def.maxDays} dias` };
  }

  private left(s: ProviderStore, r: Resolved, externalId: string, date: string): number {
    if (r.type === 'plan') return SIM_UNLIMITED;
    return s.inventory.get(`${externalId}|${date}`) ?? (r.type === 'flight' ? r.def.seats : r.def.units);
  }

  private adjust(s: ProviderStore, r: Resolved, externalId: string, dates: string[], delta: number): void {
    for (const d of dates) s.inventory.set(`${externalId}|${d}`, this.left(s, r, externalId, d) + delta);
  }

  private price(s: ProviderStore, r: Resolved, start: string, end: string | undefined, quantity: number): { total: Money; taxes: Money } {
    const cur = s.catalog.currency;
    let total: number;
    let taxes: number;
    if (r.type === 'flight') {
      taxes = r.def.taxCents * quantity;
      total = r.def.fareCents * quantity + taxes;
    } else if (r.type === 'room') {
      const nights = nightsOf(start, end ?? addDaysIso(start, 1)).length;
      const subtotal = r.def.nightCents * nights * quantity;
      taxes = Math.round(subtotal * SIM_ROOM_TAX_RATE);
      total = subtotal + taxes;
    } else {
      taxes = 0;
      total = r.def.priceCents * quantity;
    }
    return { total: { amount: fromCents(total), currency: cur }, taxes: { amount: fromCents(taxes), currency: cur } };
  }

  private sweep(s: ProviderStore): void {
    const now = this.now();
    for (const h of s.holds.values()) {
      if (h.status === 'ACTIVE' && h.expiresAt <= now) {
        h.status = 'EXPIRED';
        const r = this.resolve(s.catalog, h.externalId);
        if (r) this.adjust(s, r, h.externalId, h.dates, h.quantity);
      }
    }
  }

  private locator(prefix: string): string {
    return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  // ---------------- puerto ----------------

  async healthCheck(): Promise<AdapterResult<HealthCheckData>> {
    return ok({ reachable: true, latencyMs: 0, detail: 'Adaptador simulado en memoria (sin red)' });
  }

  async searchAvailability(q: AvailabilityQuery, ctx: AdapterCallContext): Promise<AdapterResult<AvailabilityResult>> {
    const s = this.store(ctx);
    this.sweep(s);
    if (!isIsoDate(q.startDate) || (q.endDate !== undefined && !isIsoDate(q.endDate))) return fail(adapterError('INVALID_REQUEST', 'Fechas invalidas'));
    const observedAt = new Date(this.now()).toISOString();
    const code = ctx.provider.providerCode;
    const items: CanonicalAvailability[] = [];

    if (q.kind === 'FLIGHT') {
      const last = q.endDate ?? q.startDate;
      const today = todayIso(this.now());
      for (let d = q.startDate; diffDaysIso(d, last) >= 0; d = addDaysIso(d, 1)) {
        const offset = diffDaysIso(today, d);
        if (offset < 0 || offset >= SIM_HORIZON_DAYS) continue;
        for (const def of s.catalog.flights) {
          if (q.origin && def.origin !== q.origin.toUpperCase()) continue;
          if (q.destination && def.destination !== q.destination.toUpperCase()) continue;
          const r: Resolved = { type: 'flight', def, date: d };
          const available = this.left(s, r, flightExternalId(def, d), d);
          if (available >= q.quantity) items.push({ product: flightProduct(def, d, code), date: d, availableQuantity: available, source: 'PROVIDER_LIVE', observedAt });
        }
      }
    } else if (q.kind === 'ROOM') {
      const nights = nightsOf(q.startDate, q.endDate ?? addDaysIso(q.startDate, 1));
      if (nights.length < 1 || nights.length > 30) return fail(adapterError('INVALID_REQUEST', 'La estadia debe tener entre 1 y 30 noches'));
      for (const def of s.catalog.rooms) {
        if (q.hotelExternalId && def.hotel.code !== q.hotelExternalId) continue;
        if (q.adults !== undefined && q.adults > def.maxOccupancy * q.quantity) continue;
        const r: Resolved = { type: 'room', def };
        for (const night of nights) {
          const available = this.left(s, r, def.code, night);
          if (available >= q.quantity) items.push({ product: roomProduct(def, code), date: night, availableQuantity: available, source: 'PROVIDER_LIVE', observedAt });
        }
      }
    } else {
      const days = q.endDate ? diffDaysIso(q.startDate, q.endDate) + 1 : 1;
      for (const def of s.catalog.plans) {
        if (days > def.maxDays) continue;
        items.push({ product: planProduct(def, code), date: q.startDate, availableQuantity: SIM_UNLIMITED, source: 'PROVIDER_LIVE', observedAt });
      }
    }
    return ok({ items });
  }

  async getRates(q: RateQuery, ctx: AdapterCallContext): Promise<AdapterResult<RateResult>> {
    const s = this.store(ctx);
    if (!isIsoDate(q.startDate) || (q.endDate !== undefined && !isIsoDate(q.endDate)) || q.quantity < 1) {
      return fail(adapterError('INVALID_REQUEST', 'Fechas o cantidad invalidas'));
    }
    const rates: CanonicalRate[] = [];
    for (const ref of q.products) {
      const r = this.resolve(s.catalog, ref.externalId);
      if (!r) continue;
      const start = r.type === 'flight' ? r.date : q.startDate;
      if (!Array.isArray(this.dates(r, start, q.endDate))) continue;
      const { total, taxes } = this.price(s, r, start, q.endDate, q.quantity);
      rates.push({
        ref: { providerCode: ctx.provider.providerCode, externalId: ref.externalId }, rateCode: 'BAR', total, taxes,
        validFrom: start, validTo: q.endDate ?? start, refundable: r.type !== 'flight', providerRateRef: `SIMRATE-${ref.externalId}`,
      });
    }
    return ok({ rates });
  }

  private order(s: ProviderStore, req: { product: { externalId: string }; startDate: string; endDate?: string; quantity: number; travelers: unknown[] }) {
    if (!Number.isInteger(req.quantity) || req.quantity < 1) return { error: adapterError('INVALID_REQUEST', 'Cantidad invalida') };
    if (req.travelers.length === 0) return { error: adapterError('INVALID_REQUEST', 'Se requiere al menos un viajero') };
    if (!isIsoDate(req.startDate) || (req.endDate !== undefined && !isIsoDate(req.endDate))) return { error: adapterError('INVALID_REQUEST', 'Fechas invalidas') };
    const r = this.resolve(s.catalog, req.product.externalId);
    if (!r) return { error: adapterError('INVALID_REQUEST', `Producto inexistente en el proveedor: ${req.product.externalId}`) };
    const dates = this.dates(r, req.startDate, req.endDate);
    if (!Array.isArray(dates)) return { error: adapterError('INVALID_REQUEST', dates.error) };
    return { r, dates, price: this.price(s, r, req.startDate, req.endDate, req.quantity) };
  }

  async hold(req: HoldRequest, ctx: AdapterCallContext): Promise<AdapterResult<HoldResult>> {
    const s = this.store(ctx);
    this.sweep(s);
    const existing = [...s.holds.values()].find((h) => h.clientReference === req.clientReference && h.status === 'ACTIVE');
    if (existing) return ok({ providerHoldRef: existing.ref, expiresAt: new Date(existing.expiresAt).toISOString(), confirmedTotal: existing.total });
    const o = this.order(s, req);
    if (o.error) return fail(o.error);
    const { r, dates, price } = o;
    if (req.expectedTotal && !sameMoney(req.expectedTotal, price.total)) {
      return fail(adapterError('PRICE_CHANGED', `El precio cambio: ${price.total.amount} ${price.total.currency}`, { raw: { currentTotal: price.total } }));
    }
    if (dates.some((d) => this.left(s, r, req.product.externalId, d) < req.quantity)) return fail(adapterError('NO_AVAILABILITY', 'Sin disponibilidad'));
    this.adjust(s, r, req.product.externalId, dates, -req.quantity);
    const hold: SimHold = {
      ref: this.locator('SIMHOLD'), clientReference: req.clientReference, externalId: req.product.externalId, dates, quantity: req.quantity,
      total: price.total, expiresAt: this.now() + HOLD_TTL_MS, status: 'ACTIVE',
    };
    s.holds.set(hold.ref, hold);
    return ok({ providerHoldRef: hold.ref, expiresAt: new Date(hold.expiresAt).toISOString(), confirmedTotal: hold.total });
  }

  async confirm(req: ConfirmRequest, ctx: AdapterCallContext): Promise<AdapterResult<ConfirmResult>> {
    const s = this.store(ctx);
    this.sweep(s);
    const dup = [...s.bookings.values()].find((b) => b.clientReference === req.clientReference && b.status === 'CONFIRMED');
    if (dup) return ok({ status: 'CONFIRMED', externalLocator: dup.locator, confirmedTotal: dup.total, providerStatusRaw: 'CONFIRMED' });
    const o = this.order(s, req);
    if (o.error) return fail(o.error);
    const { r, dates } = o;
    let total = o.price.total;
    let hold: SimHold | undefined;
    if (req.providerHoldRef) {
      hold = s.holds.get(req.providerHoldRef);
      if (!hold || hold.status !== 'ACTIVE' || hold.clientReference !== req.clientReference) return fail(adapterError('REJECTED', 'El bloqueo no existe o vencio'));
      total = hold.total;
    }
    if (!sameMoney(req.expectedTotal, total)) {
      return fail(adapterError('PRICE_CHANGED', `El precio cambio: ${total.amount} ${total.currency}`, { raw: { currentTotal: total } }));
    }
    if (hold) {
      hold.status = 'CONSUMED';
    } else {
      if (dates.some((d) => this.left(s, r, req.product.externalId, d) < req.quantity)) return fail(adapterError('NO_AVAILABILITY', 'Sin disponibilidad'));
      this.adjust(s, r, req.product.externalId, dates, -req.quantity);
    }
    const booking: SimBooking = {
      locator: this.locator('SIM'), clientReference: req.clientReference, externalId: req.product.externalId, dates, quantity: req.quantity,
      total, status: 'CONFIRMED',
    };
    s.bookings.set(booking.locator, booking);
    return ok({ status: 'CONFIRMED', externalLocator: booking.locator, confirmedTotal: total, providerStatusRaw: 'CONFIRMED' });
  }

  async cancel(req: CancelRequest, ctx: AdapterCallContext): Promise<AdapterResult<CancelResult>> {
    const s = this.store(ctx);
    const b = s.bookings.get(req.externalLocator);
    if (!b || b.clientReference !== req.clientReference) return fail(adapterError('REJECTED', 'Reserva inexistente en el proveedor'));
    if (b.status === 'CONFIRMED') {
      b.status = 'CANCELLED';
      const r = this.resolve(s.catalog, b.externalId);
      if (r) this.adjust(s, r, b.externalId, b.dates, b.quantity);
    }
    return ok({ status: 'CANCELLED' });
  }

  async queryBooking(req: QueryBookingRequest, ctx: AdapterCallContext): Promise<AdapterResult<QueryBookingResult>> {
    const s = this.store(ctx);
    const b = req.externalLocator
      ? s.bookings.get(req.externalLocator)
      : [...s.bookings.values()].find((x) => x.clientReference === req.clientReference && x.status === 'CONFIRMED')
        ?? [...s.bookings.values()].find((x) => x.clientReference === req.clientReference);
    if (!b) return ok({ found: false, status: 'UNKNOWN' });
    return ok({ found: true, status: b.status, externalLocator: b.locator, total: b.total });
  }
}
