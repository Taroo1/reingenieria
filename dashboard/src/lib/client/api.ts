export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface Meta {
  correlationId?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

async function request<T>(method: string, path: string, body?: unknown, idempotent = false): Promise<{ data: T; meta: Meta }> {
  const headers: Record<string, string> = { 'x-mgt-csrf': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Una clave por accion: si se corta la red se reintenta una vez con la misma clave (no duplica la operacion).
  if (idempotent) headers['idempotency-key'] = `ui-${crypto.randomUUID()}`;
  const send = () => fetch(`/api/proxy/${path.replace(/^\//, '')}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  let res: Response;
  try {
    res = await send();
  } catch {
    res = await send();
  }
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, 'UNAUTHORIZED', 'Sesion vencida');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Error HTTP ${res.status}`, e?.details);
  }
  return { data: json?.data as T, meta: (json?.meta ?? {}) as Meta };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, idempotent = false) => request<T>('POST', path, body ?? {}, idempotent),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
