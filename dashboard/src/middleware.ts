import { NextRequest, NextResponse } from 'next/server';

const ACCESS_COOKIE = 'mgt_at';
const REFRESH_COOKIE = 'mgt_rt';

/** Las pantallas requieren sesion: sin cookies se redirige al login (la autorizacion real la hace el backend). */
export function middleware(req: NextRequest) {
  const has = req.cookies.get(ACCESS_COOKIE)?.value || req.cookies.get(REFRESH_COOKIE)?.value;
  if (has) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
};
