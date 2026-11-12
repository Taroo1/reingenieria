import { describe, expect, it, vi } from 'vitest';
import { backendPath, csrfOk } from './proxy';
import { __resetRotations, refreshSession } from './session';

const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers: new Headers(headers) });

describe('backendPath', () => {
  it('acepta rutas normales y rechaza salir del prefijo del backend', () => {
    expect(backendPath(['bookings', 'abc-123', 'confirm'])).toBe('bookings/abc-123/confirm');
    expect(backendPath(['..', 'health'])).toBeNull();
    expect(backendPath(['.'])).toBeNull();
    expect(backendPath(['a%2F..'])).toBeNull();
    expect(backendPath([])).toBeNull();
  });
});

describe('csrfOk', () => {
  it('GET siempre; escrituras solo con la cabecera propia y Origin del mismo host', () => {
    expect(csrfOk(req('GET'), 'app.local')).toBe(true);
    expect(csrfOk(req('POST'), 'app.local')).toBe(false);
    expect(csrfOk(req('POST', { 'x-mgt-csrf': '1' }), 'app.local')).toBe(true);
    expect(csrfOk(req('POST', { 'x-mgt-csrf': '1', origin: 'http://app.local' }), 'app.local')).toBe(true);
    expect(csrfOk(req('DELETE', { 'x-mgt-csrf': '1', origin: 'https://evil.example' }), 'app.local')).toBe(false);
  });
});

describe('refreshSession', () => {
  it('peticiones simultaneas con el mismo refresh token comparten UNA rotacion (no dispara la deteccion de reuso)', async () => {
    __resetRotations();
    const tokens = { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900, user: { id: '1', email: 'x', fullName: 'X', role: 'ADMIN' } };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: tokens }), { status: 200 }));
    const results = await Promise.all([1, 2, 3].map(() => refreshSession('r1', fetchImpl as unknown as typeof fetch)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok && r.tokens.accessToken === 'a2')).toBe(true);
  });

  it('un refresh rechazado informa el estado y no inventa tokens', async () => {
    __resetRotations();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await refreshSession('vencido', fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, status: 401 });
  });
});
