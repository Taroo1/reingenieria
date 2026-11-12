import { ExternalRef, IsoDateTime } from './common';

export interface CanonicalFlight {
  kind: 'FLIGHT';
  ref: ExternalRef;
  carrier: string;
  flightNumber: string;
  /** Codigo IATA de 3 letras. */
  origin: string;
  destination: string;
  departureAt: IsoDateTime;
  arrivalAt: IsoDateTime;
  cabin: string;
}

export interface CanonicalHotel {
  ref: ExternalRef;
  name: string;
  city: string;
  country: string;
  stars?: number;
  allInclusive: boolean;
}

export interface CanonicalRoom {
  kind: 'ROOM';
  ref: ExternalRef;
  hotel: CanonicalHotel;
  roomType: string;
  boardBasis: string;
  maxOccupancy: number;
}

export interface CanonicalAssistancePlan {
  kind: 'ASSISTANCE_PLAN';
  ref: ExternalRef;
  planName: string;
  coverageSummary?: string;
  maxDays?: number;
  /** Cobertura medica en USD, como cadena decimal. */
  medicalCoverageUsd?: string;
}

export type CanonicalProduct = CanonicalFlight | CanonicalRoom | CanonicalAssistancePlan;
