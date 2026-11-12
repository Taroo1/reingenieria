import type { Money } from '../../modules/normalization/canonical';

/** Importe decimal con hasta 2 decimales, como lo usa el modelo canonico ("1234.50"). */
export const MONEY_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class MoneyFormatError extends Error {}

/** Convierte "1234.5" a 123450 centavos. Los importes se manejan siempre en enteros. */
export function toCents(amount: string): number {
  if (typeof amount !== 'string' || !MONEY_PATTERN.test(amount)) throw new MoneyFormatError(`Importe invalido: ${String(amount)}`);
  const negative = amount.startsWith('-');
  const [int, dec = ''] = (negative ? amount.slice(1) : amount).split('.');
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new MoneyFormatError(`Centavos invalidos: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const money = (cents: number, currency: string): Money => ({ amount: fromCents(cents), currency });

export function isMoney(v: unknown): v is Money {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.amount === 'string' && MONEY_PATTERN.test(m.amount) && typeof m.currency === 'string' && CURRENCY_PATTERN.test(m.currency);
}

/** Igualdad exacta de importe y moneda ("100.5" === "100.50"). */
export function sameMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && toCents(a.amount) === toCents(b.amount);
}
