/**
 * Redaccion de datos sensibles antes de guardar o registrar cualquier objeto
 * (auditoria, transacciones de integracion, logs).
 */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|api[-_]?key|credential|cookie|private[-_]?key|document[-_]?number|card/i;

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const MAX_STRING = 4000;

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[truncado]` : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[BINARY]';
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out;
}

/** Redacta y limita el tamano serializado para columnas JSON de trazabilidad. */
export function toStorablePayload(value: unknown, maxBytes = 32_768): unknown {
  if (value === undefined) return null;
  const redacted = redactSecrets(value);
  const json = JSON.stringify(redacted);
  if (json !== undefined && Buffer.byteLength(json) > maxBytes) {
    return { truncated: true, originalBytes: Buffer.byteLength(json), preview: json.slice(0, 2000) };
  }
  return redacted;
}
