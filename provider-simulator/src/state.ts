/**
 * Estado en memoria de cada proveedor ficticio: inventario, bloqueos, reservas e idempotencia.
 * Un proceso Node atiende las peticiones de a una por vez, por lo que cada operacion es atomica.
 */
import {
  defaultUnits, findProduct, flightsBetween, inventoryDates, priceFor, Product, ProviderDef, PROVIDERS, roomSku, UNLIMITED_UNITS,
} from './catalog';
import { addDays, diffDays, fmtDate, isRecord, money, parseDate, parseMoneyCents, randomId } from './util';

export interface SimResponse {
  status: number;
  body: unknown;
}

interface Hold {
  holdId: string;
  clientRef: string;
  sku: string;
  units: number;
  dates: string[];
  dateFrom: string;
  dateTo: string | null;
  totalCents: number;
  taxCents: number;
  expiresAt: number;
  status: 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
}

interface Booking {
  locator: string;
  clientRef: string;
  sku: string;
  units: number;
  dates: string[];
  dateFrom: string;
  dateTo: string | null;
  totalCents: number;
  taxCents: number;
  refundable: boolean;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  confirmAt: number;
  createdAt: number;
  passengers: number;
}

interface IdemEntry {
  fingerprint: string;
  response: SimResponse;
  expiresAt: number;
}

export interface ProviderRuntime {
  def: ProviderDef;
  inventory: Map<string, number>;
  holds: Map<string, Hold>;
  bookings: Map<string, Booking>;
  idempotency: Map<string, IdemEntry>;
  priceOverrides: Map<string, number>;
  requests: Record<string, number>;
}

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

const err = (status: number, code: string, message: string, extra?: Record<string, unknown>): SimResponse => ({
  status,
  body: { error: { code, message, ...extra } },
});

export class SimState {
  private readonly runtimes = new Map<string, ProviderRuntime>();

  constructor(
    readonly holdTtlMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  now(): number {
    return this.clock();
  }

  providerCodes(): string[] {
    return Object.keys(PROVIDERS);
  }

  runtime(code: string): ProviderRuntime | null {
    const def = PROVIDERS[code];
    if (!def) return null;
    let rt = this.runtimes.get(code);
    if (!rt) {
      rt = { def, inventory: new Map(), holds: new Map(), bookings: new Map(), idempotency: new Map(), priceOverrides: new Map(), requests: {} };
      this.runtimes.set(code, rt);
    }
    return rt;
  }

  reset(): void {
    this.runtimes.clear();
  }

  // ---------------- inventario ----------------

  private key(sku: string, date: string): string {
    return `${sku}|${date}`;
  }

  unitsLeft(rt: ProviderRuntime, product: Product, date: string): number {
    if (product.type === 'assistance') return UNLIMITED_UNITS;
    return rt.inventory.get(this.key(product.sku, date)) ?? defaultUnits(product);
  }

  private adjust(rt: ProviderRuntime, product: Product, dates: string[], delta: number): void {
    for (const d of dates) rt.inventory.set(this.key(product.sku, d), this.unitsLeft(rt, product, d) + delta);
  }

  setInventory(rt: ProviderRuntime, sku: string, date: string, units: number): boolean {
    const product = findProduct(rt.def, sku, this.now());
    if (!product || product.type === 'assistance') return false;
    rt.inventory.set(this.key(sku, date), units);
    return true;
  }

  /** Libera los bloqueos vencidos (el proveedor real lo hace por su cuenta). */
  sweep(rt: ProviderRuntime): void {
    const now = this.now();
    for (const h of rt.holds.values()) {
      if (h.status === 'ACTIVE' && h.expiresAt <= now) {
        h.status = 'EXPIRED';
        const product = findProduct(rt.def, h.sku, now);
        if (product) this.adjust(rt, product, h.dates, h.units);
      }
    }
    for (const [k, v] of rt.idempotency) if (v.expiresAt <= now) rt.idempotency.delete(k);
  }

  private price(rt: ProviderRuntime, product: Product, from: Date, to: Date | null, units: number) {
    return priceFor(product, from, to, units, rt.priceOverrides.get(product.sku));
  }

  private amount(rt: ProviderRuntime, totalCents: number, taxCents: number) {
    return { total: money(totalCents), taxes: money(taxCents), currency: rt.def.currency };
  }

  // ---------------- disponibilidad ----------------

  availability(rt: ProviderRuntime, body: unknown): SimResponse {
    if (!isRecord(body)) return err(400, 'INVALID_REQUEST', 'cuerpo JSON requerido');
    const type = body.product_type;
    const from = parseDate(body.date_from);
    const to = body.date_to === undefined || body.date_to === null ? null : parseDate(body.date_to);
    const units = body.units === undefined ? 1 : body.units;
    if (!from) return err(400, 'INVALID_REQUEST', 'date_from invalida (YYYY-MM-DD)');
    if (body.date_to !== undefined && body.date_to !== null && !to) return err(400, 'INVALID_REQUEST', 'date_to invalida (YYYY-MM-DD)');
    if (to && to.getTime() < from.getTime()) return err(400, 'INVALID_REQUEST', 'date_to anterior a date_from');
    if (to && diffDays(from, to) > 60) return err(400, 'INVALID_REQUEST', 'el rango maximo es de 60 dias');
    if (typeof units !== 'number' || !Number.isInteger(units) || units < 1) return err(400, 'INVALID_REQUEST', 'units invalido');
    const now = this.now();
    const observed = new Date(now).toISOString();
    const results: unknown[] = [];

    if (type === 'flight') {
      if (!rt.def.flights) return { status: 200, body: { results, generated_at: observed } };
      const origin = typeof body.origin === 'string' ? body.origin.toUpperCase() : undefined;
      const destination = typeof body.destination === 'string' ? body.destination.toUpperCase() : undefined;
      for (const p of flightsBetween(rt.def, from, to ?? from, now, origin, destination)) {
        if (p.type !== 'flight') continue;
        const left = this.unitsLeft(rt, p, p.date);
        if (left < units) continue;
        results.push({
          sku: p.sku, type: 'flight', date: p.date, units_left: left,
          flight: {
            airline: p.def.airline, number: p.def.number, from: p.def.from, to: p.def.to,
            dep: p.departure.toISOString(), arr: p.arrival.toISOString(), cabin_class: 'Y',
          },
        });
      }
    } else if (type === 'room') {
      const hotelCode = typeof body.hotel_code === 'string' ? body.hotel_code : undefined;
      const checkout = to ?? addDays(from, 1);
      const nights = diffDays(from, checkout);
      if (nights < 1) return err(400, 'INVALID_REQUEST', 'la estadia debe tener al menos una noche');
      for (const hotel of rt.def.hotels ?? []) {
        if (hotelCode && hotel.code !== hotelCode) continue;
        for (const room of hotel.rooms) {
          const product = findProduct(rt.def, roomSku(hotel, room), now)!;
          for (let i = 0; i < nights; i++) {
            const date = fmtDate(addDays(from, i));
            const left = this.unitsLeft(rt, product, date);
            if (left < units) continue;
            results.push({
              sku: product.sku, type: 'room', date, units_left: left,
              room: {
                hotel: { code: hotel.code, name: hotel.name, city: hotel.city, country_code: hotel.country, category: hotel.category, all_inclusive: hotel.allInclusive },
                room_type: room.roomType, board: hotel.board, max_pax: room.maxPax,
              },
            });
          }
        }
      }
    } else if (type === 'assistance') {
      const days = to ? diffDays(from, to) + 1 : 1;
      for (const plan of rt.def.plans ?? []) {
        if (days > plan.daysMax) continue;
        results.push({
          sku: plan.code, type: 'assistance', date: fmtDate(from), units_left: UNLIMITED_UNITS,
          plan: { name: plan.name, days_max: plan.daysMax, medical_usd: plan.medicalUsd, summary: plan.summary },
        });
      }
    } else {
      return err(400, 'INVALID_REQUEST', 'product_type debe ser flight, room o assistance');
    }
    return { status: 200, body: { results, generated_at: observed } };
  }

  // ---------------- tarifas ----------------

  rates(rt: ProviderRuntime, body: unknown): SimResponse {
    if (!isRecord(body) || !Array.isArray(body.skus) || body.skus.length === 0 || body.skus.length > 50) {
      return err(400, 'INVALID_REQUEST', 'skus debe ser una lista de 1 a 50 elementos');
    }
    const from = parseDate(body.date_from);
    const to = body.date_to === undefined || body.date_to === null ? null : parseDate(body.date_to);
    const units = body.units === undefined ? 1 : body.units;
    if (!from) return err(400, 'INVALID_REQUEST', 'date_from invalida (YYYY-MM-DD)');
    if (typeof units !== 'number') return err(400, 'INVALID_REQUEST', 'units invalido');
    const offers: unknown[] = [];
    const unknown: string[] = [];
    const invalid: Array<{ sku: string; reason: string }> = [];
    for (const sku of body.skus) {
      const product = typeof sku === 'string' ? findProduct(rt.def, sku, this.now()) : null;
      if (!product) {
        unknown.push(String(sku));
        continue;
      }
      const price = this.price(rt, product, from, to, units);
      if ('error' in price) {
        invalid.push({ sku: product.sku, reason: price.error });
        continue;
      }
      offers.push({
        sku: product.sku,
        fare_code: product.refundable ? 'FLEX' : 'SAVER',
        amount: this.amount(rt, price.totalCents, price.taxCents),
        valid_from: fmtDate(from),
        valid_to: fmtDate(to ?? from),
        refundable: product.refundable,
        offer_ref: `OF-${product.sku}-${fmtDate(from)}-${units}`,
      });
    }
    return { status: 200, body: { offers, unknown_skus: unknown, invalid } };
  }

  // ---------------- bloqueos ----------------

  private parseOrder(rt: ProviderRuntime, body: unknown) {
    if (!isRecord(body)) return { error: err(400, 'INVALID_REQUEST', 'cuerpo JSON requerido') };
    const clientRef = body.client_ref;
    if (typeof clientRef !== 'string' || clientRef.length < 1 || clientRef.length > 100) {
      return { error: err(400, 'INVALID_REQUEST', 'client_ref requerido') };
    }
    const product = typeof body.sku === 'string' ? findProduct(rt.def, body.sku, this.now()) : null;
    if (!product) return { error: err(400, 'INVALID_REQUEST', 'sku inexistente') };
    const from = parseDate(body.date_from);
    const to = body.date_to === undefined || body.date_to === null ? null : parseDate(body.date_to);
    if (!from) return { error: err(400, 'INVALID_REQUEST', 'date_from invalida (YYYY-MM-DD)') };
    if (product.type === 'flight' && fmtDate(from) !== product.date) {
      return { error: err(400, 'INVALID_REQUEST', 'date_from no coincide con la fecha del vuelo') };
    }
    const units = body.units;
    if (typeof units !== 'number' || !Number.isInteger(units)) return { error: err(400, 'INVALID_REQUEST', 'units invalido') };
    const price = this.price(rt, product, from, to, units);
    if ('error' in price) return { error: err(400, 'INVALID_REQUEST', price.error) };
    const passengers = Array.isArray(body.passengers) ? body.passengers : [];
    if (passengers.length === 0) return { error: err(400, 'INVALID_REQUEST', 'se requiere al menos un pasajero') };
    for (const pax of passengers) {
      if (!isRecord(pax) || typeof pax.first_name !== 'string' || typeof pax.last_name !== 'string') {
        return { error: err(400, 'INVALID_REQUEST', 'cada pasajero requiere first_name y last_name') };
      }
    }
    let expectedCents: number | null = null;
    if (body.expected_total !== undefined && body.expected_total !== null) {
      const et = body.expected_total;
      if (!isRecord(et) || et.currency !== rt.def.currency) {
        return { error: err(400, 'INVALID_REQUEST', `expected_total debe expresarse en ${rt.def.currency}`) };
      }
      expectedCents = parseMoneyCents(et.amount);
      if (expectedCents === null) return { error: err(400, 'INVALID_REQUEST', 'expected_total.amount invalido') };
    }
    return {
      order: {
        clientRef, product, from, to, units, price, expectedCents, passengers: passengers.length,
        holdId: typeof body.hold_id === 'string' ? body.hold_id : undefined,
      },
    };
  }

  createHold(rt: ProviderRuntime, body: unknown): SimResponse {
    if (!rt.def.supportsHolds) return err(405, 'HOLD_NOT_SUPPORTED', 'este proveedor no permite bloqueos previos');
    this.sweep(rt);
    const parsed = this.parseOrder(rt, body);
    if (parsed.error) return parsed.error;
    const o = parsed.order!;
    if (o.expectedCents !== null && o.expectedCents !== o.price.totalCents) {
      return err(409, 'PRICE_MISMATCH', 'el precio cambio', { current_total: this.amount(rt, o.price.totalCents, o.price.taxCents) });
    }
    const existing = [...rt.holds.values()].find((h) => h.clientRef === o.clientRef && h.status === 'ACTIVE');
    if (existing) return { status: 200, body: this.holdView(rt, existing) };

    const dates = inventoryDates(o.product, o.from, o.to);
    if (dates.some((d) => this.unitsLeft(rt, o.product, d) < o.units)) return err(409, 'SOLD_OUT', 'sin disponibilidad');
    this.adjust(rt, o.product, dates, -o.units);
    const hold: Hold = {
      holdId: randomId('H'), clientRef: o.clientRef, sku: o.product.sku, units: o.units, dates,
      dateFrom: fmtDate(o.from), dateTo: o.to ? fmtDate(o.to) : null,
      totalCents: o.price.totalCents, taxCents: o.price.taxCents, expiresAt: this.now() + this.holdTtlMs, status: 'ACTIVE',
    };
    rt.holds.set(hold.holdId, hold);
    return { status: 201, body: this.holdView(rt, hold) };
  }

  private holdView(rt: ProviderRuntime, h: Hold) {
    return { hold_id: h.holdId, client_ref: h.clientRef, sku: h.sku, expires_at: new Date(h.expiresAt).toISOString(), price: this.amount(rt, h.totalCents, h.taxCents) };
  }

  // ---------------- reservas ----------------

  createBooking(rt: ProviderRuntime, body: unknown): SimResponse {
    this.sweep(rt);
    const parsed = this.parseOrder(rt, body);
    if (parsed.error) return parsed.error;
    const o = parsed.order!;

    if (rt.def.dedupeByClientRef) {
      const dup = [...rt.bookings.values()].find((b) => b.clientRef === o.clientRef && b.status !== 'CANCELLED');
      if (dup) return { status: 200, body: this.bookingView(rt, dup) };
    }

    let hold: Hold | undefined;
    if (o.holdId) {
      hold = rt.holds.get(o.holdId);
      if (!hold || hold.status !== 'ACTIVE') return err(409, 'HOLD_EXPIRED', 'el bloqueo no existe o ya vencio');
      if (hold.clientRef !== o.clientRef || hold.sku !== o.product.sku || hold.units !== o.units) {
        return err(400, 'INVALID_REQUEST', 'los datos no coinciden con el bloqueo');
      }
    }
    // Con bloqueo, el precio es el garantizado en el bloqueo; sin bloqueo, el vigente.
    const totalCents = hold ? hold.totalCents : o.price.totalCents;
    const taxCents = hold ? hold.taxCents : o.price.taxCents;
    if (o.expectedCents !== null && o.expectedCents !== totalCents) {
      return err(409, 'PRICE_MISMATCH', 'el precio cambio', { current_total: this.amount(rt, totalCents, taxCents) });
    }
    const dates = inventoryDates(o.product, o.from, o.to);
    if (hold) {
      hold.status = 'CONSUMED';
    } else {
      if (dates.some((d) => this.unitsLeft(rt, o.product, d) < o.units)) return err(409, 'SOLD_OUT', 'sin disponibilidad');
      this.adjust(rt, o.product, dates, -o.units);
    }
    const now = this.now();
    const booking: Booking = {
      locator: randomId(rt.def.code.slice(0, 3), 6), clientRef: o.clientRef, sku: o.product.sku, units: o.units, dates,
      dateFrom: fmtDate(o.from), dateTo: o.to ? fmtDate(o.to) : null, totalCents, taxCents, refundable: o.product.refundable,
      status: rt.def.confirmMode === 'instant' ? 'CONFIRMED' : 'PENDING',
      confirmAt: now + rt.def.onRequestDelaySec * 1000, createdAt: now, passengers: o.passengers,
    };
    rt.bookings.set(booking.locator, booking);
    return { status: 201, body: this.bookingView(rt, booking) };
  }

  private refresh(b: Booking): void {
    if (b.status === 'PENDING' && this.now() >= b.confirmAt) b.status = 'CONFIRMED';
  }

  private bookingView(rt: ProviderRuntime, b: Booking) {
    this.refresh(b);
    return {
      locator: b.locator, client_ref: b.clientRef, sku: b.sku, units: b.units, status: b.status,
      date_from: b.dateFrom, date_to: b.dateTo, price: this.amount(rt, b.totalCents, b.taxCents),
      created_at: new Date(b.createdAt).toISOString(),
    };
  }

  cancelBooking(rt: ProviderRuntime, locator: string, body: unknown): SimResponse {
    const b = rt.bookings.get(locator);
    if (!b) return err(404, 'BOOKING_NOT_FOUND', 'localizador inexistente');
    if (!isRecord(body) || body.client_ref !== b.clientRef) return err(400, 'INVALID_REQUEST', 'client_ref no coincide con la reserva');
    this.refresh(b);
    if (b.status !== 'CANCELLED') {
      b.status = 'CANCELLED';
      const product = findProduct(rt.def, b.sku, this.now());
      if (product) this.adjust(rt, product, b.dates, b.units);
    }
    return {
      status: 200,
      body: { locator: b.locator, status: 'CANCELLED', penalty: b.refundable ? null : this.amount(rt, b.totalCents, b.taxCents) },
    };
  }

  queryBookings(rt: ProviderRuntime, clientRef: string): SimResponse {
    const list = [...rt.bookings.values()].filter((b) => b.clientRef === clientRef).sort((a, b) => a.createdAt - b.createdAt);
    return { status: 200, body: { bookings: list.map((b) => this.bookingView(rt, b)) } };
  }

  getBooking(rt: ProviderRuntime, locator: string): SimResponse {
    const b = rt.bookings.get(locator);
    if (!b) return err(404, 'BOOKING_NOT_FOUND', 'localizador inexistente');
    return { status: 200, body: { bookings: [this.bookingView(rt, b)] } };
  }

  // ---------------- idempotencia (cabecera Idempotency-Key) ----------------

  idempotencyLookup(rt: ProviderRuntime, scope: string, key: string, fingerprint: string): SimResponse | 'MISMATCH' | null {
    const e = rt.idempotency.get(`${scope}|${key}`);
    if (!e || e.expiresAt <= this.now()) return null;
    return e.fingerprint === fingerprint ? e.response : 'MISMATCH';
  }

  idempotencyStore(rt: ProviderRuntime, scope: string, key: string, fingerprint: string, response: SimResponse): void {
    // Solo se recuerdan resultados definitivos: un 5xx permite reintentar con la misma clave.
    if (response.status >= 500) return;
    rt.idempotency.set(`${scope}|${key}`, { fingerprint, response, expiresAt: this.now() + IDEMPOTENCY_TTL_MS });
  }

  stats(rt: ProviderRuntime) {
    this.sweep(rt);
    const bookings = [...rt.bookings.values()];
    const byClientRef: Record<string, number> = {};
    for (const b of bookings) byClientRef[b.clientRef] = (byClientRef[b.clientRef] ?? 0) + 1;
    return {
      provider: rt.def.code,
      requests: rt.requests,
      holds_active: [...rt.holds.values()].filter((h) => h.status === 'ACTIVE').length,
      bookings_total: bookings.length,
      bookings_active: bookings.filter((b) => b.status !== 'CANCELLED').length,
      bookings_by_client_ref: byClientRef,
    };
  }
}
