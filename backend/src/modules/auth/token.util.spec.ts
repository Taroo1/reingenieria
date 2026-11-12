import { generateRefreshToken, hashToken, refreshExpiry } from './token.util';

describe('token.util', () => {
  it('genera tokens unicos y largos', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(64);
  });

  it('el hash es deterministico y no revela el token', () => {
    const t = generateRefreshToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toHaveLength(64);
  });

  it('calcula el vencimiento en dias', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    expect(refreshExpiry(7, base).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});
