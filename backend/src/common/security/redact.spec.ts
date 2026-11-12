import { REDACTED, redactSecrets, toStorablePayload } from './redact';

describe('redactSecrets', () => {
  it('oculta claves sensibles en cualquier nivel', () => {
    const out = redactSecrets({
      user: 'ana',
      password: 'x',
      nested: { apiKey: 'k', Authorization: 'Bearer abc', ok: 1 },
      list: [{ token: 't' }, { name: 'n' }],
      credentialsEnc: 'v1.a.b.c',
    }) as any;
    expect(out.user).toBe('ana');
    expect(out.password).toBe(REDACTED);
    expect(out.nested.apiKey).toBe(REDACTED);
    expect(out.nested.Authorization).toBe(REDACTED);
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].token).toBe(REDACTED);
    expect(out.list[1].name).toBe('n');
    expect(out.credentialsEnc).toBe(REDACTED);
  });

  it('no modifica el objeto original', () => {
    const input = { password: 'x' };
    redactSecrets(input);
    expect(input.password).toBe('x');
  });

  it('serializa fechas y limita la profundidad', () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n; }
    expect(JSON.stringify(redactSecrets(deep))).toContain('[MAX_DEPTH]');
    expect((redactSecrets({ d: new Date('2026-01-01T00:00:00Z') }) as any).d).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('toStorablePayload', () => {
  it('devuelve null para undefined', () => {
    expect(toStorablePayload(undefined)).toBeNull();
  });

  it('trunca cargas demasiado grandes', () => {
    const out = toStorablePayload({ data: 'x'.repeat(100_000) }, 1000) as any;
    expect(out.truncated).toBe(true);
    expect(out.originalBytes).toBeGreaterThan(1000);
  });
});
