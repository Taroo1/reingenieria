/**
 * Maquina de estados de la reserva (decidida en la Etapa 1).
 *
 *   DRAFT -> QUOTED -> HELD -> PENDING_CONFIRMATION -> CONFIRMED -> CANCEL_REQUESTED -> CANCELLED
 *                                          |-> REQUIRES_REVIEW   (resultado incierto o compensacion incompleta)
 *                                          |-> COMPENSATING -> FAILED | REQUIRES_REVIEW
 *                                          |-> FAILED
 *   QUOTED/HELD -> EXPIRED (vencio la cotizacion o el bloqueo)
 *
 * Un timeout al confirmar NUNCA lleva a CONFIRMED: el item queda PENDING_CONFIRMATION hasta conciliar
 * con el proveedor. La base exige ademas que CONFIRMED tenga todos los items CONFIRMED con localizador.
 */
export type BookingStatusName =
  | 'DRAFT' | 'QUOTED' | 'HELD' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REQUIRES_REVIEW'
  | 'COMPENSATING' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'FAILED' | 'EXPIRED';

export type ItemStatusName = 'PENDING' | 'HELD' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'REQUIRES_REVIEW';

export const BOOKING_TRANSITIONS: Record<BookingStatusName, readonly BookingStatusName[]> = {
  DRAFT: ['QUOTED', 'FAILED', 'EXPIRED'],
  QUOTED: ['HELD', 'FAILED', 'EXPIRED'],
  HELD: ['PENDING_CONFIRMATION', 'FAILED', 'EXPIRED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'REQUIRES_REVIEW', 'COMPENSATING', 'FAILED'],
  REQUIRES_REVIEW: ['CONFIRMED', 'COMPENSATING', 'FAILED', 'CANCELLED'],
  COMPENSATING: ['FAILED', 'REQUIRES_REVIEW'],
  CONFIRMED: ['CANCEL_REQUESTED'],
  CANCEL_REQUESTED: ['CANCELLED', 'REQUIRES_REVIEW'],
  CANCELLED: [],
  FAILED: [],
  EXPIRED: [],
};

export const ITEM_TRANSITIONS: Record<ItemStatusName, readonly ItemStatusName[]> = {
  PENDING: ['HELD', 'FAILED'],
  HELD: ['PENDING_CONFIRMATION', 'FAILED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'FAILED', 'REQUIRES_REVIEW', 'CANCELLED'],
  REQUIRES_REVIEW: ['CONFIRMED', 'FAILED', 'CANCELLED'],
  CONFIRMED: ['CANCEL_REQUESTED', 'CANCELLED'],
  CANCEL_REQUESTED: ['CANCELLED', 'REQUIRES_REVIEW'],
  CANCELLED: [],
  FAILED: [],
};

export const canTransition = (from: BookingStatusName, to: BookingStatusName): boolean => BOOKING_TRANSITIONS[from].includes(to);
export const canTransitionItem = (from: ItemStatusName, to: ItemStatusName): boolean => ITEM_TRANSITIONS[from].includes(to);

/** Estados de origen validos para llegar a `to` (para los UPDATE condicionales). */
export const sourcesOf = (to: BookingStatusName): BookingStatusName[] =>
  (Object.keys(BOOKING_TRANSITIONS) as BookingStatusName[]).filter((s) => BOOKING_TRANSITIONS[s].includes(to));

/**
 * Resultado de la reserva segun sus items tras intentar confirmar:
 *  - todos CONFIRMED -> CONFIRMED
 *  - alguno FAILED y otro ya comprometido con el proveedor -> COMPENSATING (hay que deshacer)
 *  - todos FAILED -> FAILED
 *  - alguno en revision (sin fallas) -> REQUIRES_REVIEW
 *  - alguno pendiente -> se queda en PENDING_CONFIRMATION (null: sin cambio)
 */
export function confirmationOutcome(items: ItemStatusName[]): BookingStatusName | null {
  if (items.length === 0) return 'FAILED';
  if (items.every((s) => s === 'CONFIRMED')) return 'CONFIRMED';
  const failed = items.some((s) => s === 'FAILED');
  const committed = items.some((s) => s === 'CONFIRMED' || s === 'PENDING_CONFIRMATION' || s === 'REQUIRES_REVIEW');
  if (failed && committed) return 'COMPENSATING';
  if (failed) return 'FAILED';
  if (items.some((s) => s === 'REQUIRES_REVIEW')) return 'REQUIRES_REVIEW';
  return null;
}
