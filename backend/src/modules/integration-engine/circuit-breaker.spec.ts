import { acquire, BreakerConfig, BreakerState, initialState, onFailure, onSuccess, release } from './circuit-breaker';

const cfg: BreakerConfig = { failureThreshold: 3, resetTimeoutMs: 1000, halfOpenMaxCalls: 2, trialLeaseMs: 500 };
const t = (ms: number) => new Date(1_000_000 + ms);

function failN(s: BreakerState, n: number, at = t(0)): BreakerState {
  for (let i = 0; i < n; i++) s = onFailure(s, at, cfg).next ?? s;
  return s;
}

describe('circuit breaker', () => {
  it('CLOSED permite y abre al alcanzar el umbral de fallas consecutivas', () => {
    let s = initialState();
    expect(acquire(s, t(0), cfg)).toEqual({ allowed: true, trial: false, next: null });
    s = failN(s, 2);
    expect(s.state).toBe('CLOSED');
    const r = onFailure(s, t(0), cfg);
    expect(r.transition).toBe('OPENED');
    expect(r.next).toMatchObject({ state: 'OPEN', openedAt: t(0), nextAttemptAt: t(1000) });
  });

  it('un exito en CLOSED reinicia el contador (fallas consecutivas, no acumuladas)', () => {
    let s = failN(initialState(), 2);
    s = onSuccess(s, cfg).next ?? s;
    expect(s.failureCount).toBe(0);
    s = failN(s, 2);
    expect(s.state).toBe('CLOSED');
  });

  it('OPEN rechaza hasta resetTimeout y luego deja pasar UNA prueba (HALF_OPEN con lease)', () => {
    const open = failN(initialState(), 3);
    const early = acquire(open, t(999), cfg);
    expect(early.allowed).toBe(false);
    if (!early.allowed) expect(early.retryAt).toEqual(t(1000));

    const trial = acquire(open, t(1000), cfg);
    expect(trial.allowed && trial.trial).toBe(true);
    const half = trial.next!;
    expect(half.state).toBe('HALF_OPEN');
    expect(acquire(half, t(1200), cfg).allowed).toBe(false); // otra prueba en curso
    expect(acquire(half, t(1501), cfg).allowed).toBe(true); // lease vencido
  });

  it('HALF_OPEN cierra tras halfOpenMaxCalls exitos y reabre ante una falla', () => {
    const half = acquire(failN(initialState(), 3), t(1000), cfg).next!;
    const one = onSuccess(half, cfg);
    expect(one.transition).toBeNull();
    expect(one.next).toMatchObject({ state: 'HALF_OPEN', successCount: 1, nextAttemptAt: null });
    const two = onSuccess(one.next!, cfg);
    expect(two.transition).toBe('CLOSED');
    expect(two.next).toEqual(initialState());

    const reopened = onFailure(half, t(1100), cfg);
    expect(reopened.transition).toBe('OPENED');
    expect(reopened.next).toMatchObject({ state: 'OPEN', nextAttemptAt: t(2100) });
  });

  it('libera el lease de una prueba que no llego a ejecutarse', () => {
    const half = acquire(failN(initialState(), 3), t(1000), cfg).next!;
    expect(release(half)?.nextAttemptAt).toBeNull();
    expect(release(initialState())).toBeNull();
  });
});
