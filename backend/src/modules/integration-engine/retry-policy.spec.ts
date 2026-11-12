import { adapterError } from '../adapters/adapter-errors';
import { backoffDelay, shouldRetry } from './retry-policy';

describe('backoffDelay', () => {
  it('crece exponencialmente hasta el tope, mas jitter en [0, base)', () => {
    const noJitter = () => 0;
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 100, 1000, noJitter))).toEqual([100, 200, 400, 800, 1000, 1000]);
    expect(backoffDelay(1, 100, 1000, () => 0.999)).toBe(199);
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(3, 100, 1000);
      expect(d).toBeGreaterThanOrEqual(400);
      expect(d).toBeLessThan(500);
    }
  });

  it('no desborda con muchos reintentos', () => {
    expect(backoffDelay(500, 200, 5000, () => 0)).toBe(5000);
  });
});

describe('shouldRetry', () => {
  const transient = adapterError('UNAVAILABLE', 'x', { retryable: true });
  const cfg = { maxRetries: 3, supportsIdempotency: false };

  it('reintenta lecturas transitorias hasta maxRetries', () => {
    expect(shouldRetry('SEARCH', transient, 1, cfg)).toBe(true);
    expect(shouldRetry('SEARCH', transient, 3, cfg)).toBe(true);
    expect(shouldRetry('SEARCH', transient, 4, cfg)).toBe(false);
    expect(shouldRetry('QUERY_BOOKING', transient, 1, cfg)).toBe(true);
  });

  it('nunca reintenta errores no reintentables ni el health-check', () => {
    expect(shouldRetry('SEARCH', adapterError('NO_AVAILABILITY', 'x'), 1, cfg)).toBe(false);
    expect(shouldRetry('HEALTH_CHECK', transient, 1, cfg)).toBe(false);
  });

  it('escrituras: solo con idempotencia del proveedor', () => {
    const unknown = adapterError('TIMEOUT', 'x', { retryable: true, outcomeUnknown: true });
    expect(shouldRetry('CONFIRM', unknown, 1, cfg)).toBe(false);
    expect(shouldRetry('HOLD', transient, 1, cfg)).toBe(false);
    expect(shouldRetry('CONFIRM', unknown, 1, { ...cfg, supportsIdempotency: true })).toBe(true);
    expect(shouldRetry('CANCEL', transient, 4, { ...cfg, supportsIdempotency: true })).toBe(false);
  });
});
