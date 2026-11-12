import { NextRequest, NextResponse } from 'next/server';
import { csrfOk } from '@/lib/server/proxy';
import { API_URL, logBackendError, TokenSet, writeTokens } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Inicia sesion contra el backend y guarda los tokens en cookies httpOnly. Al navegador solo le llega el usuario. */
export async function POST(req: NextRequest) {
  if (!csrfOk(req, req.headers.get('host'))) {
    return NextResponse.json({ error: { code: 'CSRF_REJECTED', message: 'Peticion rechazada', statusCode: 403 } }, { status: 403 });
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await req.text(),
      cache: 'no-store',
    });
  } catch (err) {
    logBackendError('login', err);
    return NextResponse.json({ error: { code: 'BACKEND_UNREACHABLE', message: 'No se pudo contactar al backend', statusCode: 502 } }, { status: 502 });
  }
  const text = await res.text();
  if (!res.ok) return new NextResponse(text, { status: res.status, headers: { 'content-type': 'application/json' } });
  const tokens = (JSON.parse(text) as { data: TokenSet }).data;
  const out = NextResponse.json({ data: { user: tokens.user } });
  writeTokens(out.cookies, tokens);
  return out;
}
