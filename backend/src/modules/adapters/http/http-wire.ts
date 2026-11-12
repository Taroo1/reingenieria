/**
 * Protocolo REST de proveedor "MGT Provider REST v1" (el que implementa provider-simulator) y su
 * traduccion al modelo canonico. Toda respuesta se valida antes de usarse: un dato con forma inesperada
 * es un PROTOCOL_ERROR, nunca un valor por defecto silencioso.
 *
 * Rutas relativas a la baseUrl del proveedor:
 *   GET  /health                      POST /availability     POST /rates
 *   POST /holds                       POST /bookings         POST /bookings/{locator}/cancel
 *   GET  /bookings?client_ref=...     GET  /bookings/{locator}
 */
import { createHash } from 'node:crypto';
import { CURRENCY_PATTERN, MONEY_PATTERN } from '../../../common/money/money';
import {
  AvailabilityQuery, AvailabilityResult, CanonicalAvailability, CanonicalItemStatus, CanonicalProduct, CanonicalRate,
  CancelRequest, CancelResult, ConfirmRequest, ConfirmResult, HoldRequest, HoldResult, Money, ProductKind,
  QueryBookingResult, RateQuery, RateResult, TravelerData,
} from '../../normalization/canonical';
import { ProtocolError } from '../adapter-errors';

// ---------------- lectura validada ----------------

type Obj = Record<string, unknown>;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ProtocolError(`${path}: se esperaba un objeto`);
  return v as Obj;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ProtocolError(`${path}: se esperaba una lista`);
  return v;
}
function str(o: Obj, k: string, path: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0 || v.length > 500) throw new ProtocolError(`${path}.${k}: texto requerido`);
  return v;
}
function optStr(o: Obj, k: string, path: string): string | undefined {
  return o[k] === undefined || o[k] === null ? undefined : str(o, k, path);
}
function int(o: Obj, k: string, path: string, min = 0): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new ProtocolError(`${path}.${k}: entero >= ${min} requerido`);
  return v;
}
function bool(o: Obj, k: string, path: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') throw new ProtocolError(`${path}.${k}: booleano requerido`);
  return v;
}
function date(o: Obj, k: string, path: string): string {
  const v = str(o, k, path);
  if (!DATE_RE.test(v)) throw new ProtocolError(`${path}.${k}: fecha YYYY-MM-DD requerida`);
  return v;
}
function instant(o: Obj, k: string, path: string): string {
  const v = str(o, k, path);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new ProtocolError(`${path}.${k}: instante ISO 8601 requerido`);
  return new Date(t).toISOString();
}
function amount(v: unknown, path: string): { total: Money; taxes: Money } {
  const o = obj(v, path);
  const currency = str(o, 'currency', path);
  const total = str(o, 'total', path);
  const taxes = o.taxes === undefined ? '0.00' : str(o, 'taxes', path);
  if (!CURRENCY_PATTERN.test(currency)) throw new ProtocolError(`${path}.currency: codigo ISO 4217 requerido`);
  if (!MONEY_PATTERN.test(total) || !MONEY_PATTERN.test(taxes)) throw new ProtocolError(`${path}: importe decimal invalido`);
  return { total: { amount: total, currency }, taxes: { amount: taxes, currency } };
}

/** Serializacion estable (claves ordenadas) para detectar cambios en la sincronizacion. */
export function stableHash(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x as Obj).sort().map((k) => [k, norm((x as Obj)[k])]));
    return x;
  };
  return createHash('sha256').update(JSON.stringify(norm(v))).digest('hex');
}

// ---------------- vocabularios del proveedor ----------------

const KIND_TO_WIRE: Record<ProductKind, string> = { FLIGHT: 'flight', ROOM: 'room', ASSISTANCE_PLAN: 'assistance' };
const CABINS: Record<string, string> = { Y: 'ECONOMY', W: 'PREMIUM_ECONOMY', C: 'BUSINESS', J: 'BUSINESS', F: 'FIRST' };
const ROOM_TYPES: Record<string, string> = { SGL: 'SINGLE', DBL: 'DOUBLE', TWN: 'TWIN', TPL: 'TRIPLE', FAM: 'FAMILY', STE: 'SUITE' };
const BOARDS: Record<string, string> = { RO: 'ROOM_ONLY', BB: 'BREAKFAST', HB: 'HALF_BOARD', FB: 'FULL_BOARD', AI: 'ALL_INCLUSIVE' };
const STATUSES: Record<string, CanonicalItemStatus> = {
  CONFIRMED: 'CONFIRMED', PENDING: 'PENDING_CONFIRMATION', ON_REQUEST: 'PENDING_CONFIRMATION', ON_HOLD: 'HELD',
  REJECTED: 'REJECTED', CANCELLED: 'CANCELLED',
};

export const mapStatus = (raw: string): CanonicalItemStatus => STATUSES[raw.toUpperCase()] ?? 'UNKNOWN';

/** Codigos de error 409 del proveedor -> codigo canonico. */
export function mapBusinessCode(code: string | undefined): 'NO_AVAILABILITY' | 'PRICE_CHANGED' | 'REJECTED' {
  if (code === 'SOLD_OUT' || code === 'NO_AVAILABILITY') return 'NO_AVAILABILITY';
  if (code === 'PRICE_MISMATCH' || code === 'PRICE_CHANGED') return 'PRICE_CHANGED';
  return 'REJECTED';
}

export function errorCodeOf(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const e = (body as Obj).error;
  if (typeof e !== 'object' || e === null) return {};
  const code = (e as Obj).code;
  const message = (e as Obj).message;
  return { code: typeof code === 'string' ? code : undefined, message: typeof message === 'string' ? message.slice(0, 300) : undefined };
}

// ---------------- peticiones ----------------

export const availabilityRequest = (q: AvailabilityQuery) => ({
  product_type: KIND_TO_WIRE[q.kind],
  date_from: q.startDate,
  ...(q.endDate && { date_to: q.endDate }),
  units: q.quantity,
  ...(q.origin && { origin: q.origin }),
  ...(q.destination && { destination: q.destination }),
  ...(q.hotelExternalId && { hotel_code: q.hotelExternalId }),
  ...(q.adults !== undefined && { adults: q.adults }),
});

export const ratesRequest = (q: RateQuery) => ({
  skus: q.products.map((p) => p.externalId),
  date_from: q.startDate,
  ...(q.endDate && { date_to: q.endDate }),
  units: q.quantity,
});

const passengers = (t: TravelerData[]) =>
  t.map((p) => ({
    first_name: p.firstName,
    last_name: p.lastName,
    ...(p.email && { email: p.email }),
    ...(p.documentType && { doc_type: p.documentType }),
    ...(p.documentNumber && { doc_number: p.documentNumber }),
    ...(p.birthDate && { birth_date: p.birthDate }),
  }));

export const holdRequest = (r: HoldRequest) => ({
  client_ref: r.clientReference,
  sku: r.product.externalId,
  units: r.quantity,
  date_from: r.startDate,
  ...(r.endDate && { date_to: r.endDate }),
  ...(r.expectedTotal && { expected_total: r.expectedTotal }),
  passengers: passengers(r.travelers),
});

export const confirmRequest = (r: ConfirmRequest) => ({
  client_ref: r.clientReference,
  ...(r.providerHoldRef && { hold_id: r.providerHoldRef }),
  sku: r.product.externalId,
  units: r.quantity,
  date_from: r.startDate,
  ...(r.endDate && { date_to: r.endDate }),
  expected_total: r.expectedTotal,
  passengers: passengers(r.travelers),
});

export const cancelRequest = (r: CancelRequest) => ({ client_ref: r.clientReference, ...(r.reason && { reason: r.reason }) });

// ---------------- respuestas ----------------

function product(item: Obj, kind: string, providerCode: string, path: string): CanonicalProduct {
  const sku = str(item, 'sku', path);
  const ref = { providerCode, externalId: sku, rawHash: stableHash(item[kind === 'assistance' ? 'plan' : kind]) };
  if (kind === 'flight') {
    const f = obj(item.flight, `${path}.flight`);
    const p = `${path}.flight`;
    const cabin = str(f, 'cabin_class', p);
    const iata = (k: string) => {
      const v = str(f, k, p).toUpperCase();
      if (!/^[A-Z]{3}$/.test(v)) throw new ProtocolError(`${p}.${k}: codigo IATA de 3 letras requerido`);
      return v;
    };
    return {
      kind: 'FLIGHT', ref, carrier: str(f, 'airline', p), flightNumber: str(f, 'number', p),
      origin: iata('from'), destination: iata('to'), departureAt: instant(f, 'dep', p), arrivalAt: instant(f, 'arr', p),
      cabin: CABINS[cabin] ?? cabin,
    };
  }
  if (kind === 'room') {
    const r = obj(item.room, `${path}.room`);
    const p = `${path}.room`;
    const h = obj(r.hotel, `${p}.hotel`);
    const hp = `${p}.hotel`;
    const roomType = str(r, 'room_type', p);
    const board = str(r, 'board', p);
    const stars = h.category === undefined || h.category === null ? undefined : int(h, 'category', hp, 1);
    return {
      kind: 'ROOM', ref, roomType: ROOM_TYPES[roomType] ?? roomType, boardBasis: BOARDS[board] ?? board, maxOccupancy: int(r, 'max_pax', p, 1),
      hotel: {
        ref: { providerCode, externalId: str(h, 'code', hp) }, name: str(h, 'name', hp), city: str(h, 'city', hp),
        country: str(h, 'country_code', hp), ...(stars !== undefined && { stars }), allInclusive: bool(h, 'all_inclusive', hp),
      },
    };
  }
  if (kind === 'assistance') {
    const pl = obj(item.plan, `${path}.plan`);
    const p = `${path}.plan`;
    const medical = optStr(pl, 'medical_usd', p);
    if (medical !== undefined && !MONEY_PATTERN.test(medical)) throw new ProtocolError(`${p}.medical_usd: importe invalido`);
    return {
      kind: 'ASSISTANCE_PLAN', ref, planName: str(pl, 'name', p), coverageSummary: optStr(pl, 'summary', p),
      maxDays: pl.days_max === undefined ? undefined : int(pl, 'days_max', p, 1), medicalCoverageUsd: medical,
    };
  }
  throw new ProtocolError(`${path}.type: tipo de producto desconocido (${kind})`);
}

/** Normaliza la disponibilidad y elimina duplicados (mismo sku y fecha) que algunos proveedores repiten. */
export function parseAvailability(body: unknown, query: AvailabilityQuery, providerCode: string): AvailabilityResult {
  const root = obj(body, 'respuesta');
  const results = arr(root.results, 'respuesta.results');
  const observedAt = root.generated_at === undefined ? new Date().toISOString() : instant(root, 'generated_at', 'respuesta');
  const expected = KIND_TO_WIRE[query.kind];
  const seen = new Set<string>();
  const items: CanonicalAvailability[] = [];
  results.forEach((raw, i) => {
    const path = `respuesta.results[${i}]`;
    const item = obj(raw, path);
    const kind = str(item, 'type', path);
    if (kind !== expected) throw new ProtocolError(`${path}.type: se pidio ${expected} y llego ${kind}`);
    const p = product(item, kind, providerCode, path);
    const day = date(item, 'date', path);
    const key = `${p.ref.externalId}|${day}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ product: p, date: day, availableQuantity: int(item, 'units_left', path), source: 'PROVIDER_LIVE', observedAt });
  });
  return { items };
}

export function parseRates(body: unknown, providerCode: string): RateResult {
  const root = obj(body, 'respuesta');
  const offers = arr(root.offers, 'respuesta.offers');
  const seen = new Set<string>();
  const rates: CanonicalRate[] = [];
  offers.forEach((raw, i) => {
    const path = `respuesta.offers[${i}]`;
    const o = obj(raw, path);
    const sku = str(o, 'sku', path);
    const rateCode = str(o, 'fare_code', path);
    const key = `${sku}|${rateCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { total, taxes } = amount(o.amount, `${path}.amount`);
    rates.push({
      ref: { providerCode, externalId: sku, rawHash: stableHash(o) }, rateCode, total, taxes,
      validFrom: date(o, 'valid_from', path), validTo: date(o, 'valid_to', path),
      ...(o.refundable !== undefined && { refundable: bool(o, 'refundable', path) }),
      ...(o.offer_ref !== undefined && { providerRateRef: str(o, 'offer_ref', path) }),
    });
  });
  return { rates };
}

export function parseHold(body: unknown): HoldResult {
  const o = obj(body, 'respuesta');
  return {
    providerHoldRef: str(o, 'hold_id', 'respuesta'),
    ...(o.expires_at !== undefined && { expiresAt: instant(o, 'expires_at', 'respuesta') }),
    confirmedTotal: amount(o.price, 'respuesta.price').total,
  };
}

export function parseBooking(raw: unknown, path: string): { locator: string; clientRef?: string; status: CanonicalItemStatus; statusRaw: string; total?: Money } {
  const o = obj(raw, path);
  const statusRaw = str(o, 'status', path);
  return {
    locator: str(o, 'locator', path),
    clientRef: optStr(o, 'client_ref', path),
    status: mapStatus(statusRaw),
    statusRaw,
    ...(o.price !== undefined && { total: amount(o.price, `${path}.price`).total }),
  };
}

export function parseConfirm(body: unknown): ConfirmResult {
  const b = parseBooking(body, 'respuesta');
  return { status: b.status, externalLocator: b.locator, ...(b.total && { confirmedTotal: b.total }), providerStatusRaw: b.statusRaw };
}

export function parseCancel(body: unknown): CancelResult {
  const o = obj(body, 'respuesta');
  const raw = str(o, 'status', 'respuesta').toUpperCase();
  const status: CancelResult['status'] = raw === 'CANCELLED' ? 'CANCELLED' : raw === 'REJECTED' ? 'REJECTED' : 'PENDING';
  return { status, ...(o.penalty !== undefined && o.penalty !== null && { penalty: amount(o.penalty, 'respuesta.penalty').total }) };
}

/**
 * Elige el estado a informar entre las reservas que el proveedor devuelve para una referencia.
 * Si hay localizador se usa ese; si no, la primera vigente (no cancelada); si todas estan canceladas, CANCELLED.
 */
export function parseQuery(body: unknown, externalLocator?: string): QueryBookingResult {
  const root = obj(body, 'respuesta');
  const list = arr(root.bookings, 'respuesta.bookings').map((b, i) => parseBooking(b, `respuesta.bookings[${i}]`));
  const chosen = (externalLocator && list.find((b) => b.locator === externalLocator)) || list.find((b) => b.status !== 'CANCELLED') || list[0];
  if (!chosen) return { found: false, status: 'UNKNOWN' };
  return { found: true, status: chosen.status, externalLocator: chosen.locator, ...(chosen.total && { total: chosen.total }) };
}
