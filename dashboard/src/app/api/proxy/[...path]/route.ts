import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/server/proxy';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

const handle = async (req: NextRequest, ctx: Ctx) => proxyToBackend(req, (await ctx.params).path);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
