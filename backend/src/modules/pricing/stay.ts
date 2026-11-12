import { addDaysIso, diffDaysIso, isIsoDate, nightsOf } from '../../common/time/dates';
import { ProductKind } from '../normalization/canonical';

export const MAX_NIGHTS = 30;
export const MAX_TRIP_DAYS = 365;

/** Valida las fechas segun el tipo de producto. Devuelve el motivo del rechazo o null. */
export function stayError(kind: ProductKind, startDate: string, endDate?: string | null): string | null {
  if (!isIsoDate(startDate)) return 'startDate no es una fecha valida (YYYY-MM-DD)';
  if (endDate !== undefined && endDate !== null && !isIsoDate(endDate)) return 'endDate no es una fecha valida (YYYY-MM-DD)';
  if (kind === 'ROOM') {
    if (!endDate) return 'Las habitaciones requieren endDate (fecha de salida)';
    const n = diffDaysIso(startDate, endDate);
    if (n < 1 || n > MAX_NIGHTS) return `La estadia debe tener entre 1 y ${MAX_NIGHTS} noches`;
  } else if (kind === 'FLIGHT') {
    if (endDate) return 'Un vuelo se identifica por su fecha de salida: no lleva endDate';
  } else if (endDate) {
    const d = diffDaysIso(startDate, endDate) + 1;
    if (d < 1 || d > MAX_TRIP_DAYS) return `El viaje debe durar entre 1 y ${MAX_TRIP_DAYS} dias`;
  }
  return null;
}

/** Fechas que consumen cupo: cada noche de hotel, el dia del vuelo; la asistencia no tiene cupo. */
export function inventoryDates(kind: ProductKind, startDate: string, endDate?: string | null): string[] {
  if (kind === 'ROOM') return nightsOf(startDate, endDate ?? addDaysIso(startDate, 1));
  if (kind === 'FLIGHT') return [startDate];
  return [];
}

/** Unidades de tarifa: noches (habitacion) o 1 (vuelo, plan). */
export function rateUnits(kind: ProductKind, startDate: string, endDate?: string | null): number {
  return kind === 'ROOM' ? inventoryDates(kind, startDate, endDate).length : 1;
}

/** Ultimo dia que debe cubrir la vigencia de la tarifa. */
export function lastRateDate(kind: ProductKind, startDate: string, endDate?: string | null): string {
  if (kind === 'ROOM') return addDaysIso(endDate ?? addDaysIso(startDate, 1), -1);
  if (kind === 'ASSISTANCE_PLAN' && endDate) return endDate;
  return startDate;
}
