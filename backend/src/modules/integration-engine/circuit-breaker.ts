/**
 * Maquina de estados del circuit breaker (funciones puras; la persistencia esta en CircuitBreakerService).
 *
 *  CLOSED    -- fallas consecutivas >= failureThreshold -->  OPEN
 *  OPEN      -- vence resetTimeoutMs -------------------->  HALF_OPEN (se permite una llamada de prueba)
 *  HALF_OPEN -- halfOpenMaxCalls pruebas exitosas ------->  CLOSED
 *  HALF_OPEN -- una prueba falla ------------------------>  OPEN
 *
 * En HALF_OPEN las pruebas son secuenciales: la que esta en curso tiene un "lease" (nextAttemptAt) y las
 * demas llamadas se rechazan hasta que termine o venza el lease. halfOpenMaxCalls es la cantidad de
 * pruebas exitosas consecutivas necesarias para cerrar. Todo el estado vive en la base, por lo que
 * funciona igual con varias replicas de la API.
 */
export type CircuitStateName = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerState {
  state: CircuitStateName;
  failureCount: number;
  successCount: number;
  openedAt: Date | null;
  nextAttemptAt: Date | null;
}

export interface BreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  /** Duracion maxima de una llamada de prueba (timeouts + reintentos); al vencer, otra llamada puede probar. */
  trialLeaseMs: number;
}

export type AcquireDecision =
  | { allowed: true; trial: boolean; next: BreakerState | null }
  | { allowed: false; retryAt: Date | null; next: null };

export type Transition = 'OPENED' | 'CLOSED' | null;

export const initialState = (): BreakerState => ({ state: 'CLOSED', failureCount: 0, successCount: 0, openedAt: null, nextAttemptAt: null });

export function acquire(s: BreakerState, now: Date, cfg: BreakerConfig): AcquireDecision {
  if (s.state === 'CLOSED') return { allowed: true, trial: false, next: null };
  if (s.nextAttemptAt && now.getTime() < s.nextAttemptAt.getTime()) {
    return { allowed: false, retryAt: s.nextAttemptAt, next: null };
  }
  const lease = new Date(now.getTime() + cfg.trialLeaseMs);
  if (s.state === 'OPEN') {
    return { allowed: true, trial: true, next: { ...s, state: 'HALF_OPEN', successCount: 0, nextAttemptAt: lease } };
  }
  return { allowed: true, trial: true, next: { ...s, nextAttemptAt: lease } };
}

export function onSuccess(s: BreakerState, cfg: BreakerConfig): { next: BreakerState | null; transition: Transition } {
  if (s.state === 'CLOSED') {
    return s.failureCount === 0 ? { next: null, transition: null } : { next: { ...s, failureCount: 0 }, transition: null };
  }
  if (s.state === 'HALF_OPEN') {
    const successes = s.successCount + 1;
    if (successes >= cfg.halfOpenMaxCalls) return { next: initialState(), transition: 'CLOSED' };
    return { next: { ...s, successCount: successes, nextAttemptAt: null }, transition: null };
  }
  // OPEN: una llamada iniciada antes de abrir termino bien; no cambia el estado.
  return { next: null, transition: null };
}

export function onFailure(s: BreakerState, now: Date, cfg: BreakerConfig): { next: BreakerState | null; transition: Transition } {
  const open = (): BreakerState => ({
    state: 'OPEN', failureCount: Math.max(s.failureCount, cfg.failureThreshold), successCount: 0, openedAt: now,
    nextAttemptAt: new Date(now.getTime() + cfg.resetTimeoutMs),
  });
  if (s.state === 'CLOSED') {
    const failures = s.failureCount + 1;
    if (failures >= cfg.failureThreshold) return { next: { ...open(), failureCount: failures }, transition: 'OPENED' };
    return { next: { ...s, failureCount: failures }, transition: null };
  }
  if (s.state === 'HALF_OPEN') return { next: open(), transition: 'OPENED' };
  return { next: null, transition: null };
}

/** Libera el lease de una prueba que no llego a ejecutarse (error interno antes de llamar al proveedor). */
export function release(s: BreakerState): BreakerState | null {
  return s.state === 'HALF_OPEN' && s.nextAttemptAt ? { ...s, nextAttemptAt: null } : null;
}
