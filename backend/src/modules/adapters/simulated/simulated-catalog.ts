/**
 * Catalogo del adaptador SIMULATED (en memoria, sin red). Datos ficticios.
 * Los codigos de los proveedores del seed (SIM_AIRLINE, OWN_HOTEL, ...) tienen catalogo propio, alineado con
 * los productos de ejemplo; cualquier otro proveedor SIMULATED recibe un catalogo generico segun su tipo.
 */
import { CanonicalAssistancePlan, CanonicalFlight, CanonicalHotel, CanonicalRoom } from '../../normalization/canonical';

export interface SimFlightDef {
  carrier: string;
  number: string;
  origin: string;
  destination: string;
  departureMinutesUtc: number;
  durationMin: number;
  fareCents: number;
  taxCents: number;
  seats: number;
}

export interface SimRoomDef {
  code: string;
  hotel: Omit<CanonicalHotel, 'ref'> & { code: string };
  roomType: string;
  boardBasis: string;
  maxOccupancy: number;
  nightCents: number;
  units: number;
}

export interface SimPlanDef {
  code: string;
  planName: string;
  coverageSummary: string;
  maxDays: number;
  medicalCoverageUsd: string;
  priceCents: number;
}

export interface SimCatalog {
  currency: string;
  flights: SimFlightDef[];
  rooms: SimRoomDef[];
  plans: SimPlanDef[];
}

/** Dias hacia adelante con vuelos programados. */
export const SIM_HORIZON_DAYS = 180;
export const SIM_ROOM_TAX_RATE = 0.1;
export const SIM_UNLIMITED = 999;

const fl = (carrier: string, number: string, origin: string, destination: string, dep: string, durationMin: number, fare: number, tax: number, seats: number): SimFlightDef => {
  const [h, m] = dep.split(':').map(Number);
  return { carrier, number, origin, destination, departureMinutesUtc: h * 60 + m, durationMin, fareCents: fare * 100, taxCents: tax * 100, seats };
};

const GRAN_CARIBE = { code: 'H-GRAN-CARIBE', name: 'Gran Caribe Resort', city: 'Punta Cana', country: 'DO', stars: 5, allInclusive: true };
const PLAYA_AZUL = { code: 'H-PLAYA-AZUL', name: 'Playa Azul Beach Hotel', city: 'Cancun', country: 'MX', stars: 4, allInclusive: true };
const CENTRO_MADRID = { code: 'H-CENTRO-MADRID', name: 'Hotel Centro Madrid', city: 'Madrid', country: 'ES', stars: 4, allInclusive: false };

const CATALOGS: Record<string, SimCatalog> = {
  SIM_AIRLINE: {
    currency: 'USD',
    flights: [fl('AR', 'AR1304', 'EZE', 'PUJ', '09:00', 360, 620, 85, 24), fl('AR', 'AR1306', 'EZE', 'CUN', '09:00', 480, 710, 85, 24)],
    rooms: [], plans: [],
  },
  SIM_GDS: {
    currency: 'USD',
    flights: [fl('UX', 'UX42', 'EZE', 'MAD', '21:30', 735, 980, 150, 30), fl('DL', 'DL110', 'EZE', 'ATL', '22:45', 630, 860, 120, 30)],
    rooms: [], plans: [],
  },
  SIM_CONSOLIDATOR: {
    currency: 'USD',
    flights: [fl('G3', 'G37650', 'EZE', 'FLN', '06:00', 170, 190, 40, 40), fl('H2', 'H25150', 'EZE', 'GRU', '08:20', 165, 230, 45, 40)],
    rooms: [], plans: [],
  },
  OWN_HOTEL: {
    currency: 'USD', flights: [], plans: [],
    rooms: [
      { code: 'ROOM-GRAN-DOUBLE', hotel: GRAN_CARIBE, roomType: 'DOUBLE', boardBasis: 'ALL_INCLUSIVE', maxOccupancy: 2, nightCents: 18_000, units: 12 },
      { code: 'ROOM-GRAN-FAMILY', hotel: GRAN_CARIBE, roomType: 'FAMILY', boardBasis: 'ALL_INCLUSIVE', maxOccupancy: 4, nightCents: 29_000, units: 6 },
      { code: 'ROOM-PLAYA-DOUBLE', hotel: PLAYA_AZUL, roomType: 'DOUBLE', boardBasis: 'ALL_INCLUSIVE', maxOccupancy: 2, nightCents: 18_000, units: 12 },
      { code: 'ROOM-PLAYA-FAMILY', hotel: PLAYA_AZUL, roomType: 'FAMILY', boardBasis: 'ALL_INCLUSIVE', maxOccupancy: 4, nightCents: 29_000, units: 6 },
    ],
  },
  SIM_BEDBANK: {
    currency: 'EUR', flights: [], plans: [],
    rooms: [
      { code: 'BB-ROOM-001', hotel: CENTRO_MADRID, roomType: 'DOUBLE', boardBasis: 'BREAKFAST', maxOccupancy: 2, nightCents: 14_000, units: 5 },
      { code: 'BB-ROOM-002', hotel: CENTRO_MADRID, roomType: 'SINGLE', boardBasis: 'BREAKFAST', maxOccupancy: 1, nightCents: 10_000, units: 4 },
    ],
  },
  SIM_ASSIST: {
    currency: 'USD', flights: [], rooms: [],
    plans: [
      { code: 'ASSIST-BASIC', planName: 'Asistencia Basica', coverageSummary: 'Cobertura medica y de equipaje (datos de ejemplo)', maxDays: 15, medicalCoverageUsd: '50000.00', priceCents: 4_500 },
      { code: 'ASSIST-PLUS', planName: 'Asistencia Plus', coverageSummary: 'Cobertura medica y de equipaje (datos de ejemplo)', maxDays: 30, medicalCoverageUsd: '150000.00', priceCents: 9_800 },
    ],
  },
};

/** Catalogo generico para un proveedor SIMULATED sin catalogo propio. */
function genericCatalog(providerCode: string, providerType: string): SimCatalog {
  const p = providerCode.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) || 'SIM';
  if (providerType === 'HOTEL' || providerType === 'BEDBANK') {
    const hotel = { code: `H-${p}`, name: `Hotel ${providerCode}`, city: 'Buenos Aires', country: 'AR', stars: 3, allInclusive: false };
    return { currency: 'USD', flights: [], plans: [], rooms: [{ code: `${p}-DBL`, hotel, roomType: 'DOUBLE', boardBasis: 'BREAKFAST', maxOccupancy: 2, nightCents: 10_000, units: 5 }] };
  }
  if (providerType === 'TRAVEL_ASSISTANCE') {
    return { currency: 'USD', flights: [], rooms: [], plans: [{ code: `${p}-PLAN`, planName: `Plan ${providerCode}`, coverageSummary: 'Plan generico simulado', maxDays: 30, medicalCoverageUsd: '30000.00', priceCents: 3_000 }] };
  }
  return { currency: 'USD', rooms: [], plans: [], flights: [fl('ZZ', `ZZ${p.length * 100 + 1}`, 'EZE', 'COR', '10:00', 80, 120, 25, 20)] };
}

export function catalogFor(providerCode: string, providerType: string): SimCatalog {
  return CATALOGS[providerCode] ?? genericCatalog(providerCode, providerType);
}

const compact = (isoDate: string) => isoDate.replace(/-/g, '');

export const flightExternalId = (def: SimFlightDef, isoDate: string) => `${def.number}-${compact(isoDate)}`;

export function flightProduct(def: SimFlightDef, isoDate: string, providerCode: string): CanonicalFlight {
  const departure = new Date(Date.parse(`${isoDate}T00:00:00Z`) + def.departureMinutesUtc * 60_000);
  return {
    kind: 'FLIGHT', ref: { providerCode, externalId: flightExternalId(def, isoDate) }, carrier: def.carrier, flightNumber: def.number,
    origin: def.origin, destination: def.destination, departureAt: departure.toISOString(),
    arrivalAt: new Date(departure.getTime() + def.durationMin * 60_000).toISOString(), cabin: 'ECONOMY',
  };
}

export function roomProduct(def: SimRoomDef, providerCode: string): CanonicalRoom {
  const { code, ...hotel } = def.hotel;
  return {
    kind: 'ROOM', ref: { providerCode, externalId: def.code }, hotel: { ref: { providerCode, externalId: code }, ...hotel },
    roomType: def.roomType, boardBasis: def.boardBasis, maxOccupancy: def.maxOccupancy,
  };
}

export function planProduct(def: SimPlanDef, providerCode: string): CanonicalAssistancePlan {
  return {
    kind: 'ASSISTANCE_PLAN', ref: { providerCode, externalId: def.code }, planName: def.planName,
    coverageSummary: def.coverageSummary, maxDays: def.maxDays, medicalCoverageUsd: def.medicalCoverageUsd,
  };
}
