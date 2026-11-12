import { createHash } from 'node:crypto';

/** URL del backend. Solo existe en el servidor de Next.js: el navegador nunca llama al backend directamente. */
export const API_URL = (process.env.API_URL ?? 'http://localhost:3001')
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/\/+$/, '');

/** Deja en el log del servidor (en Vercel: Logs) la causa real cuando no se puede contactar al backend. */
export function logBackendError(where: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? ` | causa: ${err.cause.message}` : '';
  console.error(`[backend] ${where} -> ${API_URL}: ${msg}${cause}`);
}
export const ACCESS_COOKIE = 'mgt_at';
export const REFRESH_COOKIE = 'mgt_rt';
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7) * 86_400;
/** Las cookies son Secure en produccion (https). COOKIE_SECURE=false solo para pruebas locales sin https. */
const SECURE = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'OPERADOR' | 'CONSULTA';
}

export interface CookieWriter {
  set(name: string, value: string, opts: { httpOnly: boolean; secure: boolean; sameSite: 'strict'; path: string; maxAge: number }): void;
}

const cookieOpts = (maxAge: number) => ({ httpOnly: true, secure: SECURE, sameSite: 'strict' as const, path: '/', maxAge });

/** Guarda los tokens en cookies httpOnly (inaccesibles para JavaScript del navegador: mitiga robo por XSS). */
export function writeTokens(c: CookieWriter, t: Pick<TokenSet, 'accessToken' | 'refreshToken' | 'expiresIn'>): void {
  // El access token vence unos segundos antes que en el backend para renovarlo sin rechazos.
  c.set(ACCESS_COOKIE, t.accessToken, cookieOpts(Math.max(30, t.expiresIn - 15)));
  c.set(REFRESH_COOKIE, t.refreshToken, cookieOpts(REFRESH_TTL_SECONDS));
}

export function clearTokens(c: CookieWriter): void {
  c.set(ACCESS_COOKIE, '', cookieOpts(0));
  c.set(REFRESH_COOKIE, '', cookieOpts(0));
}

export type RefreshOutcome = { ok: true; tokens: TokenSet } | { ok: false; status: number };

/** Ventana durante la que un refresh token recien rotado sigue resolviendo al resultado de su rotacion. */
const ROTATION_GRACE_MS = 30_000;
const rotations = new Map<string, { promise: Promise<RefreshOutcome>; at: number }>();

const keyOf = (refreshToken: string) => createHash('sha256').update(refreshToken).digest('hex');

/**
 * Renueva la sesion. El backend rota el refresh token y, si alguien reutiliza uno ya rotado, revoca TODAS
 * las sesiones del usuario (deteccion de robo). Como el navegador puede enviar varias peticiones a la vez
 * con el mismo token viejo, aca se comparte una unica rotacion por token durante una ventana corta.
 * (Con varias instancias del dashboard se necesita afinidad de sesion o un almacen compartido.)
 */
export function refreshSession(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<RefreshOutcome> {
  const key = keyOf(refreshToken);
  const now = Date.now();
  for (const [k, v] of rotations) if (now - v.at > ROTATION_GRACE_MS) rotations.delete(k);
  const existing = rotations.get(key);
  if (existing) return existing.promise;
  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const res = await fetchImpl(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
      if (!res.ok) return { ok: false, status: res.status };
      const body = (await res.json()) as { data: TokenSet };
      return { ok: true, tokens: body.data };
    } catch (err) {
      logBackendError('refresh', err);
      return { ok: false, status: 503 };
    }
  })();
  rotations.set(key, { promise, at: now });
  return promise;
}

/** Solo para pruebas. */
export function __resetRotations(): void {
  rotations.clear();
}
