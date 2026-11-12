/**
 * CONTRATO CONGELADO (Etapa 2): modelo canonico.
 * Todo proveedor, sea simulado, HTTP o Boomi, se traduce a estos tipos. El dominio (inventario,
 * reservas, cotizaciones) no conoce el formato de ningun proveedor. Cualquier cambio exige analizar
 * el impacto en los adaptadores, el dominio y el dashboard.
 */

/** Fecha calendario, formato YYYY-MM-DD. */
export type IsoDate = string;
/** Instante en ISO 8601 con zona horaria (UTC). */
export type IsoDateTime = string;
/** Codigo ISO 4217, p. ej. USD. */
export type CurrencyCode = string;

/** Importe como cadena decimal ("1234.50") para evitar errores de coma flotante. */
export interface Money {
  amount: string;
  currency: CurrencyCode;
}

export type ProductKind = 'FLIGHT' | 'ROOM' | 'ASSISTANCE_PLAN';

/** Referencia al objeto en el proveedor de origen: nunca se pierde al normalizar. */
export interface ExternalRef {
  providerCode: string;
  externalId: string;
  /** Hash del dato original, para detectar cambios en la sincronizacion. */
  rawHash?: string;
}

/**
 * PROVIDER_LIVE: disponibilidad consultada al proveedor (cache orientativo; se revalida antes de confirmar).
 * ALLOTMENT: cupo propio pre-negociado; la base de datos es la fuente de verdad.
 */
export type AvailabilitySource = 'PROVIDER_LIVE' | 'ALLOTMENT';
