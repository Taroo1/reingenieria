/**
 * Catalogo de proveedores ficticios. Todos los datos son inventados.
 * Cada proveedor expone su propio formato (snake_case, codigos propios): el motor del backend debe normalizarlo.
 */
import { addDays, compactDate, diffDays, fmtDate, parseDate, todayUtc } from './util';

export type ProviderKind = 'GDS' | 'AIRLINE' | 'CONSOLIDATOR' | 'HOTEL' | 'BEDBANK' | 'TRAVEL_ASSISTANCE';

export interface FlightDef {
  number: string;
  airline: string;
  from: string;
  to: string;
  /** Minutos desde 00:00 UTC. */
  departureMinutesUtc: number;
  durationMin: number;
  fareCents: number;
  taxCents: number;
  seats: number;
  refundable: boolean;
}

export interface RoomDef {
  roomType: string;
  maxPax: number;
  nightCents: number;
  units: number;
}

export interface HotelDef {
  code: string;
  name: string;
  city: string;
  country: string;
  category: number;
  allInclusive: boolean;
  /** Codigo de regimen del proveedor: AI, BB, RO. */
  board: string;
  refundable: boolean;
  rooms: RoomDef[];
}

export interface PlanDef {
  code: string;
  name: string;
  daysMax: number;
  medicalUsd: string;
  summary: string;
  priceCents: number;
}

export interface ProviderDef {
  code: string;
  name: string;
  kind: ProviderKind;
  currency: string;
  /** instant: confirma en la misma llamada. on_request: queda PENDING y confirma pasado onRequestDelaySec. */
  confirmMode: 'instant' | 'on_request';
  onRequestDelaySec: number;
  /** Si el proveedor deduplica reservas por client_ref (muchos proveedores reales no lo hacen). */
  dedupeByClientRef: boolean;
  supportsHolds: boolean;
  flights?: FlightDef[];
  hotels?: HotelDef[];
  plans?: PlanDef[];
}

/** Dias hacia adelante para los que existen vuelos programados. */
export const HORIZON_DAYS = 180;
/** Unidades que se informan para productos sin inventario limitado (asistencia). */
export const UNLIMITED_UNITS = 999;
export const MAX_NIGHTS = 30;
export const ROOM_TAX_RATE = 0.1;

const f = (number: string, airline: string, from: string, to: string, dep: string, durationMin: number, fare: number, tax: number, seats: number, refundable = false): FlightDef => {
  const [h, m] = dep.split(':').map(Number);
  return { number, airline, from, to, departureMinutesUtc: h * 60 + m, durationMin, fareCents: fare * 100, taxCents: tax * 100, seats, refundable };
};

export const PROVIDERS: Record<string, ProviderDef> = {
  SKYJET: {
    code: 'SKYJET', name: 'SkyJet Airlines (ficticia)', kind: 'AIRLINE', currency: 'USD',
    confirmMode: 'instant', onRequestDelaySec: 0, dedupeByClientRef: false, supportsHolds: true,
    flights: [
      f('SJ1304', 'SJ', 'EZE', 'PUJ', '09:00', 360, 540, 85, 9),
      f('SJ1306', 'SJ', 'EZE', 'CUN', '11:30', 480, 610, 92, 9),
      f('SJ220', 'SJ', 'EZE', 'MIA', '22:10', 540, 780, 110, 12, true),
    ],
  },
  GLOBALGDS: {
    code: 'GLOBALGDS', name: 'Global GDS (ficticio)', kind: 'GDS', currency: 'USD',
    confirmMode: 'instant', onRequestDelaySec: 0, dedupeByClientRef: true, supportsHolds: true,
    flights: [
      f('AA900', 'AA', 'EZE', 'MIA', '23:00', 545, 820, 115, 20, true),
      f('LA8020', 'LA', 'EZE', 'SCL', '07:15', 135, 210, 45, 30),
      f('IB6844', 'IB', 'EZE', 'MAD', '13:40', 750, 1150, 180, 15, true),
    ],
  },
  CONSOLIDA: {
    code: 'CONSOLIDA', name: 'Consolida Viajes (ficticio)', kind: 'CONSOLIDATOR', currency: 'USD',
    confirmMode: 'instant', onRequestDelaySec: 0, dedupeByClientRef: false, supportsHolds: false,
    flights: [
      f('CM701', 'CM', 'EZE', 'PTY', '05:50', 420, 495, 70, 10),
      f('AV86', 'AV', 'EZE', 'BOG', '02:10', 360, 430, 66, 10),
    ],
  },
  HOTELNET: {
    code: 'HOTELNET', name: 'HotelNet (ficticio)', kind: 'HOTEL', currency: 'USD',
    confirmMode: 'on_request', onRequestDelaySec: 5, dedupeByClientRef: true, supportsHolds: true,
    hotels: [
      {
        code: 'HN-CARIBE', name: 'Caribe Sol Resort', city: 'Punta Cana', country: 'DO', category: 5, allInclusive: true, board: 'AI', refundable: true,
        rooms: [
          { roomType: 'DBL', maxPax: 2, nightCents: 17_500, units: 6 },
          { roomType: 'FAM', maxPax: 4, nightCents: 28_000, units: 3 },
        ],
      },
      {
        code: 'HN-RIVIERA', name: 'Riviera Maya Palace', city: 'Cancun', country: 'MX', category: 4, allInclusive: true, board: 'AI', refundable: false,
        rooms: [{ roomType: 'DBL', maxPax: 2, nightCents: 15_000, units: 8 }],
      },
    ],
  },
  BEDSPLUS: {
    code: 'BEDSPLUS', name: 'BedsPlus Bedbank (ficticio)', kind: 'BEDBANK', currency: 'EUR',
    confirmMode: 'instant', onRequestDelaySec: 0, dedupeByClientRef: true, supportsHolds: false,
    hotels: [
      {
        code: 'BP-MAD01', name: 'Hotel Gran Via Centro', city: 'Madrid', country: 'ES', category: 4, allInclusive: false, board: 'BB', refundable: true,
        rooms: [
          { roomType: 'DBL', maxPax: 2, nightCents: 13_500, units: 5 },
          { roomType: 'SGL', maxPax: 1, nightCents: 9_800, units: 4 },
        ],
      },
      {
        code: 'BP-ROM01', name: 'Albergo Trevi', city: 'Roma', country: 'IT', category: 3, allInclusive: false, board: 'RO', refundable: false,
        rooms: [{ roomType: 'DBL', maxPax: 2, nightCents: 12_000, units: 4 }],
      },
    ],
  },
  ASSISTPRO: {
    code: 'ASSISTPRO', name: 'AssistPro Asistencia al Viajero (ficticio)', kind: 'TRAVEL_ASSISTANCE', currency: 'USD',
    confirmMode: 'instant', onRequestDelaySec: 0, dedupeByClientRef: true, supportsHolds: false,
    plans: [
      { code: 'AP-BASIC', name: 'Plan Basico', daysMax: 15, medicalUsd: '50000.00', summary: 'Asistencia medica y equipaje basico', priceCents: 4_200 },
      { code: 'AP-PLUS', name: 'Plan Plus', daysMax: 30, medicalUsd: '150000.00', summary: 'Asistencia medica ampliada, equipaje y cancelacion', priceCents: 9_500 },
      { code: 'AP-ANUAL', name: 'Plan Anual Multiviaje', daysMax: 365, medicalUsd: '250000.00', summary: 'Multiples viajes en el ano, hasta 60 dias por viaje', priceCents: 31_000 },
    ],
  },
};

export type Product =
  | { type: 'flight'; sku: string; def: FlightDef; date: string; departure: Date; arrival: Date; refundable: boolean }
  | { type: 'room'; sku: string; hotel: HotelDef; room: RoomDef; refundable: boolean }
  | { type: 'assistance'; sku: string; plan: PlanDef; refundable: boolean };

export const flightSku = (def: FlightDef, day: Date): string => `${def.number}-${compactDate(day)}`;
export const roomSku = (hotel: HotelDef, room: RoomDef): string => `${hotel.code}-${room.roomType}`;

function flightInstance(def: FlightDef, day: Date): Product {
  const departure = new Date(day.getTime() + def.departureMinutesUtc * 60_000);
  return {
    type: 'flight', sku: flightSku(def, day), def, date: fmtDate(day), departure,
    arrival: new Date(departure.getTime() + def.durationMin * 60_000), refundable: def.refundable,
  };
}

/** Resuelve un sku del proveedor. Los vuelos solo existen en el horizonte [hoy, hoy + HORIZON_DAYS). */
export function findProduct(p: ProviderDef, sku: string, nowMs: number): Product | null {
  if (p.flights) {
    const m = /^(.+)-(\d{4})(\d{2})(\d{2})$/.exec(sku);
    if (m) {
      const def = p.flights.find((x) => x.number === m[1]);
      const day = parseDate(`${m[2]}-${m[3]}-${m[4]}`);
      if (def && day) {
        const offset = diffDays(todayUtc(nowMs), day);
        if (offset >= 0 && offset < HORIZON_DAYS) return flightInstance(def, day);
      }
    }
  }
  for (const hotel of p.hotels ?? []) {
    for (const room of hotel.rooms) {
      if (roomSku(hotel, room) === sku) return { type: 'room', sku, hotel, room, refundable: hotel.refundable };
    }
  }
  const plan = p.plans?.find((x) => x.code === sku);
  if (plan) return { type: 'assistance', sku, plan, refundable: true };
  return null;
}

/** Instancias de vuelo entre dos fechas (inclusive), dentro del horizonte. */
export function flightsBetween(p: ProviderDef, from: Date, to: Date, nowMs: number, origin?: string, destination?: string): Product[] {
  const out: Product[] = [];
  const today = todayUtc(nowMs);
  for (let day = from; day.getTime() <= to.getTime(); day = addDays(day, 1)) {
    const offset = diffDays(today, day);
    if (offset < 0 || offset >= HORIZON_DAYS) continue;
    for (const def of p.flights ?? []) {
      if (origin && def.from !== origin) continue;
      if (destination && def.to !== destination) continue;
      out.push(flightInstance(def, day));
    }
  }
  return out;
}

/** Fechas que consume un producto: el dia del vuelo, cada noche de hotel, o ninguna (asistencia sin cupo). */
export function inventoryDates(product: Product, from: Date, to: Date | null): string[] {
  if (product.type === 'flight') return [product.date];
  if (product.type === 'room') {
    const nights = to ? diffDays(from, to) : 1;
    return Array.from({ length: nights }, (_, i) => fmtDate(addDays(from, i)));
  }
  return [];
}

export function defaultUnits(product: Product): number {
  if (product.type === 'flight') return product.def.seats;
  if (product.type === 'room') return product.room.units;
  return UNLIMITED_UNITS;
}

export interface PriceResult {
  totalCents: number;
  taxCents: number;
}

/**
 * Precio total de la solicitud (unidades x noches/dias), con impuestos.
 * overrideUnitCents reemplaza la tarifa base por unidad (control de precios del simulador).
 */
export function priceFor(product: Product, from: Date, to: Date | null, units: number, overrideUnitCents?: number): PriceResult | { error: string } {
  if (!Number.isInteger(units) || units < 1 || units > 20) return { error: 'units debe ser un entero entre 1 y 20' };
  if (product.type === 'flight') {
    const fare = overrideUnitCents ?? product.def.fareCents;
    const tax = product.def.taxCents * units;
    return { totalCents: fare * units + tax, taxCents: tax };
  }
  if (product.type === 'room') {
    const nights = to ? diffDays(from, to) : 1;
    if (nights < 1 || nights > MAX_NIGHTS) return { error: `la estadia debe tener entre 1 y ${MAX_NIGHTS} noches` };
    const subtotal = (overrideUnitCents ?? product.room.nightCents) * nights * units;
    const tax = Math.round(subtotal * ROOM_TAX_RATE);
    return { totalCents: subtotal + tax, taxCents: tax };
  }
  const days = to ? diffDays(from, to) + 1 : 1;
  if (days < 1 || days > product.plan.daysMax) return { error: `el plan cubre como maximo ${product.plan.daysMax} dias` };
  return { totalCents: (overrideUnitCents ?? product.plan.priceCents) * units, taxCents: 0 };
}
