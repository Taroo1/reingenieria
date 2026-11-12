import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/server/proxy';

export const dynamic = 'force-dynamic';

/** Usuario de la sesion actual (renueva el token si hace falta). */
export async function GET(req: NextRequest) {
  return proxyToBackend(req, ['auth', 'me']);
}
