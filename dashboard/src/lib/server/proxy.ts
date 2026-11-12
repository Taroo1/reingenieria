import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, clearTokens, logBackendError, REFRESH_COOKIE, refreshSession, TokenSet, writeTokens } from './session';

/** Segmento de ruta seguro: impide salir del prefijo /api/v1 del backend (.., barras codificadas, etc.). */
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
export const CSRF_HEADER = 'x-mgt-csrf';
const FORWARD_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'x-correlation-id', 'accept'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'x-correlation-id', 'idempotent-replayed'];
const MAX_BODY_BYTES = 1024 * 1024;

export function backendPath(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 12) return null;
  for (const s of segments) if (!SEGMENT.test(s) || s === '.' || s === '..') return null;
  return segments.join('/');
}

/**
 * Defensa CSRF para metodos que modifican: cookies SameSite=Strict + cabecera propia obligatoria (un sitio
 * ajeno no puede agregarla sin CORS) + Origin del mismo host cuando el navegador lo envia.
 */
export function csrfOk(req: Pick<NextRequest, 'method' | 'headers'>, host: string | null): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (req.headers.get(CSRF_HEADER) !== '1') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const json = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message, statusCode: status }, meta: { correlationId: 'dashboard' } }, { status });

/** Reenvia la peticion al backend con el access token de la cookie; renueva la sesion una vez si vencio. */
export async function proxyToBackend(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const path = backendPath(segments);
  if (!path) return json(400, 'INVALID_PATH', 'Ruta invalida');
  if (!csrfOk(req, req.headers.get('host'))) return json(403, 'CSRF_REJECTED', 'Peticion rechazada (proteccion CSRF)');

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return json(413, 'PAYLOAD_TOO_LARGE', 'Cuerpo demasiado grande');
  }
  const headers: Record<string, string> = {};
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const url = `${API_URL}/api/v1/${path}${req.nextUrl.search}`;
  const call = (access: string | undefined) =>
    fetch(url, { method: req.method, headers: { ...headers, ...(access && { authorization: `Bearer ${access}` }) }, body, cache: 'no-store', redirect: 'manual' });

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let renewed: TokenSet | null = null;
  let expired = false;

  if (!access && refresh) {
    const r = await refreshSession(refresh);
    if (r.ok) {
      renewed = r.tokens;
      access = r.tokens.accessToken;
    } else {
      expired = true;
    }
  }
  let res: Response;
  try {
    res = await call(access);
    if (res.status === 401 && refresh && !renewed && !expired) {
      const r = await refreshSession(refresh);
      if (r.ok) {
        renewed = r.tokens;
        res = await call(r.tokens.accessToken);
      } else {
        expired = true;
      }
    }
  } catch (err) {
    logBackendError(`proxy ${req.method} /${path}`, err);
    return json(502, 'BACKEND_UNREACHABLE', 'No se pudo contactar al backend');
  }

  const out = new NextResponse(res.status === 204 ? null : await res.text(), { status: res.status });
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = res.headers.get(h);
    if (v) out.headers.set(h, v);
  }
  out.headers.set('cache-control', 'no-store');
  if (renewed) writeTokens(out.cookies, renewed);
  if (expired || (res.status === 401 && !renewed)) clearTokens(out.cookies);
  return out;
}
