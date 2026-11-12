import { IDEMPOTENCY_KEY_PATTERN, requestFingerprint } from './request-fingerprint';

describe('requestFingerprint', () => {
  const base = { method: 'POST', route: '/api/v1/providers', params: {}, query: {}, body: { code: 'A', name: 'B' }, userId: 'u1' };

  it('no depende del orden de las claves', () => {
    expect(requestFingerprint(base)).toBe(requestFingerprint({ ...base, body: { name: 'B', code: 'A' } }));
  });

  it('cambia con el cuerpo, la ruta o el usuario', () => {
    const h = requestFingerprint(base);
    expect(requestFingerprint({ ...base, body: { code: 'A', name: 'C' } })).not.toBe(h);
    expect(requestFingerprint({ ...base, route: '/api/v1/users' })).not.toBe(h);
    expect(requestFingerprint({ ...base, userId: 'u2' })).not.toBe(h);
  });

  it('valida el formato de la clave', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test('a1b2c3d4')).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test('corta')).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test('con espacio 1234')).toBe(false);
  });
});
