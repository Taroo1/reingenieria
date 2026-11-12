/** Fechas calendario (YYYY-MM-DD) en UTC, sin dependencias de zona horaria del servidor. */
export const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function parseIsoDate(v: string): Date {
  if (!isIsoDate(v)) throw new Error(`Fecha invalida: ${v}`);
  return new Date(`${v}T00:00:00Z`);
}

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number): string => toIsoDate(new Date(parseIsoDate(iso).getTime() + n * DAY_MS));
export const diffDaysIso = (from: string, to: string): number => Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);

export function todayIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Fechas de [from, to) — noches de una estadia. */
export function nightsOf(from: string, to: string): string[] {
  const n = diffDaysIso(from, to);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDaysIso(from, i));
}
