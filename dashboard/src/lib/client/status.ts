/**
 * Diccionario semantico de estados. Refleja exactamente los enums del backend (prisma/schema.prisma):
 * solo traduce codigos a etiquetas, tonos y descripciones; no transforma ni infiere datos.
 * El mismo codigo puede significar cosas distintas segun el dominio (p. ej. OPEN en un circuito vs. en una excepcion),
 * por eso cada dominio tiene su propio mapa.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';

export interface StatusDef {
  label: string;
  tone: Tone;
  desc?: string;
}

type Dict = Record<string, StatusDef>;

/** Estado de salud de la integracion (enum IntegrationStatus). Lo actualizan los health-checks y el motor. */
export const HEALTH: Dict = {
  HEALTHY: { label: 'Saludable', tone: 'ok', desc: 'Funcionamiento normal segun el ultimo chequeo o llamada exitosa.' },
  DEGRADED: { label: 'Degradada', tone: 'warn', desc: 'Responde, pero con problemas o rendimiento reducido (p. ej. latencia alta en el chequeo).' },
  DOWN: { label: 'Caida', tone: 'bad', desc: 'Fuera de servicio: fallo el chequeo de salud o se abrio el circuito.' },
  UNKNOWN: { label: 'Sin datos', tone: 'neutral', desc: 'No hay informacion suficiente para determinar su estado (aun no se chequeo).' },
};

/** Estado del circuit breaker (enum CircuitState). Es una dimension distinta de la salud. */
export const CIRCUIT: Dict = {
  CLOSED: { label: 'Cerrado', tone: 'info', desc: 'Permite el flujo normal de solicitudes. No implica que la integracion este saludable.' },
  OPEN: { label: 'Abierto', tone: 'bad', desc: 'Bloquea temporalmente las solicitudes tras fallas repetidas.' },
  HALF_OPEN: { label: 'Semiabierto', tone: 'warn', desc: 'Permite solicitudes de prueba para comprobar la recuperacion.' },
};
export const CIRCUIT_NONE: StatusDef = {
  label: 'Sin registro', tone: 'neutral', desc: 'El backend aun no persistio un estado de circuito: no hubo llamadas a traves del motor de integracion.',
};

export const BOOKING: Dict = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  QUOTED: { label: 'Cotizada', tone: 'info', desc: 'Creada desde una cotizacion; falta bloquear el cupo.' },
  HELD: { label: 'Bloqueada', tone: 'accent', desc: 'Cupo bloqueado; falta confirmar antes del vencimiento.' },
  PENDING_CONFIRMATION: { label: 'Pend. confirmacion', tone: 'warn', desc: 'El proveedor aun no confirmo uno o mas items.' },
  CONFIRMED: { label: 'Confirmada', tone: 'ok' },
  REQUIRES_REVIEW: { label: 'Requiere revision', tone: 'bad', desc: 'Resultado ambiguo: requiere intervencion manual.' },
  COMPENSATING: { label: 'Compensando', tone: 'warn', desc: 'Revirtiendo items tras una falla parcial.' },
  CANCEL_REQUESTED: { label: 'Cancelacion solicitada', tone: 'warn' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  FAILED: { label: 'Fallida', tone: 'bad' },
  EXPIRED: { label: 'Expirada', tone: 'neutral' },
};
/** Estados de reserva que necesitan accion de un operador. */
export const BOOKING_ATTENTION = ['REQUIRES_REVIEW', 'PENDING_CONFIRMATION', 'COMPENSATING', 'CANCEL_REQUESTED', 'FAILED'];

export const BOOKING_ITEM: Dict = {
  PENDING: { label: 'Pendiente', tone: 'neutral' },
  HELD: { label: 'Bloqueado', tone: 'accent' },
  PENDING_CONFIRMATION: { label: 'Pend. confirmacion', tone: 'warn' },
  CONFIRMED: { label: 'Confirmado', tone: 'ok' },
  FAILED: { label: 'Fallido', tone: 'bad' },
  CANCEL_REQUESTED: { label: 'Cancelacion solicitada', tone: 'warn' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
  REQUIRES_REVIEW: { label: 'Requiere revision', tone: 'bad' },
};

export const EXCEPTION_STATUS: Dict = {
  OPEN: { label: 'Abierta', tone: 'warn' },
  IN_PROGRESS: { label: 'En curso', tone: 'info' },
  RESOLVED: { label: 'Resuelta', tone: 'ok' },
  DISMISSED: { label: 'Descartada', tone: 'neutral' },
};

export const EXCEPTION_TYPE: Dict = {
  PROVIDER_ERROR: { label: 'Error del proveedor', tone: 'bad' },
  PROVIDER_TIMEOUT: { label: 'Timeout del proveedor', tone: 'warn' },
  PROVIDER_UNAVAILABLE: { label: 'Proveedor no disponible', tone: 'bad' },
  NO_AVAILABILITY: { label: 'Sin disponibilidad', tone: 'warn' },
  PRICE_CHANGED: { label: 'Cambio de precio', tone: 'warn' },
  PARTIAL_CONFIRMATION: { label: 'Confirmacion parcial', tone: 'warn' },
  CANCELLATION_FAILED: { label: 'Cancelacion fallida', tone: 'bad' },
  RECONCILIATION_MISMATCH: { label: 'Diferencia de conciliacion', tone: 'warn' },
  MANUAL_PROVIDER: { label: 'Proveedor manual', tone: 'info' },
  OTHER: { label: 'Otro', tone: 'neutral' },
};

export const SEVERITY: Dict = {
  LOW: { label: 'Baja', tone: 'neutral' },
  MEDIUM: { label: 'Media', tone: 'warn' },
  HIGH: { label: 'Alta', tone: 'bad' },
  CRITICAL: { label: 'Critica', tone: 'bad' },
};
export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const severityLevel = (s: string) => ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })[s as 'LOW'] ?? 0;

export const ALERT_STATUS: Dict = {
  OPEN: { label: 'Abierta', tone: 'warn' },
  ACKNOWLEDGED: { label: 'Reconocida', tone: 'info' },
  RESOLVED: { label: 'Resuelta', tone: 'ok' },
};

export const ALERT_KIND: Dict = {
  PROVIDER_DOWN: { label: 'Proveedor caido', tone: 'bad' },
  CIRCUIT_OPEN: { label: 'Circuito abierto', tone: 'bad' },
  HIGH_ERROR_RATE: { label: 'Tasa de error alta', tone: 'warn' },
  HIGH_LATENCY: { label: 'Latencia alta', tone: 'warn' },
  SYNC_FAILED: { label: 'Sincronizacion fallida', tone: 'warn' },
  INCONSISTENCY: { label: 'Inconsistencia', tone: 'warn' },
  EXCEPTION_OPENED: { label: 'Excepcion abierta', tone: 'info' },
};

export const OFFER_SOURCE: Dict = {
  ALLOTMENT: { label: 'Cupo propio', tone: 'accent', desc: 'Inventario contratado: la base de datos es la fuente de verdad.' },
  PROVIDER_LIVE: { label: 'En vivo', tone: 'info', desc: 'Disponibilidad consultada al proveedor; se revalida antes de confirmar.' },
};

export const SYNC_STATUS: Dict = {
  RUNNING: { label: 'En curso', tone: 'info' },
  SUCCESS: { label: 'Correcta', tone: 'ok' },
  PARTIAL: { label: 'Parcial', tone: 'warn' },
  FAILED: { label: 'Fallida', tone: 'bad' },
};

export const PRODUCT_KIND: Record<string, string> = { ROOM: 'Habitacion', FLIGHT: 'Vuelo', ASSISTANCE_PLAN: 'Asistencia' };

export const ROLE_LABEL: Record<string, string> = { ADMIN: 'Administrador', OPERADOR: 'Operador', CONSULTA: 'Consulta' };

/** Devuelve la definicion o, si el backend envia un codigo nuevo, el codigo tal cual en tono neutro. */
export function lookup(dict: Dict, code: string | null | undefined): StatusDef | null {
  if (!code) return null;
  return dict[code] ?? { label: code, tone: 'neutral' };
}
