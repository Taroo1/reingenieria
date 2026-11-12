import { CanonicalProduct } from './catalog';
import { AvailabilitySource, ExternalRef, IsoDate, IsoDateTime, Money, ProductKind } from './common';

// ---------- Disponibilidad ----------
export interface AvailabilityQuery {
  kind: ProductKind;
  startDate: IsoDate;
  endDate?: IsoDate;
  quantity: number;
  /** Vuelos. */
  origin?: string;
  destination?: string;
  /** Habitaciones: identificador del hotel en el proveedor. */
  hotelExternalId?: string;
  adults?: number;
}

export interface CanonicalAvailability {
  product: CanonicalProduct;
  date: IsoDate;
  availableQuantity: number;
  source: AvailabilitySource;
  observedAt: IsoDateTime;
}

export interface AvailabilityResult {
  items: CanonicalAvailability[];
}

// ---------- Tarifas ----------
export interface RateQuery {
  products: ExternalRef[];
  startDate: IsoDate;
  endDate?: IsoDate;
  quantity: number;
}

export interface CanonicalRate {
  ref: ExternalRef;
  rateCode: string;
  total: Money;
  taxes: Money;
  validFrom: IsoDate;
  validTo: IsoDate;
  refundable?: boolean;
  providerRateRef?: string;
}

export interface RateResult {
  rates: CanonicalRate[];
}
