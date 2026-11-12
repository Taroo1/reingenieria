import { randomBytes } from 'node:crypto';

export const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha calendario YYYY-MM-DD estricta (rechaza 2026-02-30). */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

export const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);
export const compactDate = (d: Date): string => fmtDate(d).replace(/-/g, '');
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const diffDays = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / DAY_MS);

export function todayUtc(nowMs: number): Date {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Importes en centavos enteros: nunca coma flotante. */
export const money = (cents: number): string => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
export function parseMoneyCents(value: unknown): number | null {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) return null;
  const [int, dec = ''] = value.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}-${out}`;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
