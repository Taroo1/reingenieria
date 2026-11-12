import { ExternalRef, IsoDate, IsoDateTime, Money } from './common';

/**
 * Estado de un item segun el proveedor, ya normalizado.
 * UNKNOWN significa que no se pudo establecer el resultado (timeout, respuesta ambigua): nunca equivale a CONFIRMED.
 */
export type CanonicalItemStatus = 'HELD' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'UNKNOWN';

export interface TravelerData {
  firstName: string;
  lastName: string;
  email?: string;
  documentType?: string;
  documentNumber?: string;
  birthDate?: IsoDate;
}

export interface HoldRequest {
  /** Referencia propia (id del item de reserva): el proveedor puede usarla para deduplicar. */
  clientReference: string;
  product: ExternalRef;
  quantity: number;
  startDate: IsoDate;
  endDate?: IsoDate;
  expectedTotal?: Money;
  travelers: TravelerData[];
}

export interface HoldResult {
  providerHoldRef: string;
  expiresAt?: IsoDateTime;
  confirmedTotal: Money;
}

export interface ConfirmRequest {
  clientReference: string;
  providerHoldRef?: string;
  product: ExternalRef;
  quantity: number;
  startDate: IsoDate;
  endDate?: IsoDate;
  expectedTotal: Money;
  travelers: TravelerData[];
}

export interface ConfirmResult {
  status: CanonicalItemStatus;
  /** Localizador del proveedor. Obligatorio para considerar la confirmacion valida. */
  externalLocator?: string;
  confirmedTotal?: Money;
  providerStatusRaw?: string;
}

export interface CancelRequest {
  clientReference: string;
  externalLocator: string;
  reason?: string;
}

export interface CancelResult {
  status: 'CANCELLED' | 'REJECTED' | 'PENDING';
  penalty?: Money;
}

export interface QueryBookingRequest {
  clientReference: string;
  externalLocator?: string;
}

export interface QueryBookingResult {
  found: boolean;
  status: CanonicalItemStatus;
  externalLocator?: string;
  total?: Money;
}
