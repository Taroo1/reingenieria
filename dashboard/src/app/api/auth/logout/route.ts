import { NextRequest, NextResponse } from 'next/server';
import { csrfOk } from '@/lib/server/proxy';
import { API_URL, clearTokens, REFRESH_COOKIE } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Cierra la sesion: invalida el refresh token en el backend y borra las cookies. */
export async function POST(req: NextRequest) {
  if (!csrfOk(req, req.headers.get('host'))) {
    return NextResponse.json({ error: { code: 'CSRF_REJECTED', message: 'Peticion rechazada', statusCode: 403 } }, { status: 403 });
  }
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }), cache: 'no-store',
    }).catch(() => undefined); // aunque el backend no responda, la sesion local se cierra igual
  }
  const out = NextResponse.json({ data: { loggedOut: true } });
  clearTokens(out.cookies);
  return out;
}
