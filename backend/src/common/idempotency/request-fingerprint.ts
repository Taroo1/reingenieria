import { createHash } from 'node:crypto';

/** Clave aceptada en la cabecera Idempotency-Key. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * Huella de la solicitud: metodo, ruta (patron + parametros), query, cuerpo y usuario, con claves ordenadas.
 * La misma clave con otra huella es un reuso indebido de la clave.
 */
export function requestFingerprint(input: { method: string; route: string; params: unknown; query: unknown; body: unknown; userId?: string | null }): string {
  const text = JSON.stringify(canonical({ ...input, userId: input.userId ?? null }));
  return createHash('sha256').update(text).digest('hex');
}
