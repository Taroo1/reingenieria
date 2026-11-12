import { randomBytes } from 'node:crypto';

/** Sin 0/O/1/I para que se puedan dictar por telefono sin errores. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Referencia legible y unica en la practica: PREFIJO-AAMMDD-XXXXXX (32^6 ~ 10^9 por dia). */
export function newReference(prefix: string, now = new Date()): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${d}-${s}`;
}
