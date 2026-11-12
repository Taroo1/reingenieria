import { isWriteOperation, OperationName } from '../adapters/adapter-errors';
import { AdapterError } from '../adapters/ports/provider-adapter.port';

/**
 * Espera antes del reintento n (n = 1 para el primer reintento): min(cap, base * 2^(n-1)) + jitter,
 * con jitter uniforme en [0, base). El jitter evita que muchos clientes reintenten en el mismo instante.
 */
export function backoffDelay(retryNumber: number, baseMs: number, capMs: number, random: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, retryNumber - 1));
  return Math.floor(exp + random() * baseMs);
}

export interface RetryConfig {
  maxRetries: number;
  supportsIdempotency: boolean;
}

/**
 * Se reintenta solo lo que es seguro:
 *  - lecturas (busqueda, tarifas, consulta de reserva) ante errores transitorios;
 *  - escrituras unicamente si el proveedor soporta Idempotency-Key (se reenvia la misma clave y el
 *    proveedor deduplica). Sin idempotencia, una escritura fallida NUNCA se reintenta a ciegas:
 *    si el resultado es desconocido se consulta al proveedor y se concilia.
 *  - el health-check es una sonda y no se reintenta.
 * attemptsMade cuenta los intentos ya realizados (el primero incluido).
 */
export function shouldRetry(op: OperationName, error: AdapterError, attemptsMade: number, cfg: RetryConfig): boolean {
  if (op === 'HEALTH_CHECK') return false;
  if (!error.retryable) return false;
  if (attemptsMade > cfg.maxRetries) return false;
  if (isWriteOperation(op)) return cfg.supportsIdempotency;
  return true;
}
