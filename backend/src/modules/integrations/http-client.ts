export interface HttpRequestOptions {
  url: string;
  method: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  timeoutMs: number;
}

export interface HttpResponseInfo {
  status: number;
  latencyMs: number;
}

export interface HttpJsonRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** Cuerpo JSON (excluyente con form). */
  json?: unknown;
  /** Cuerpo application/x-www-form-urlencoded (token OAuth2). */
  form?: Record<string, string>;
  timeoutMs: number;
  /** Cancelacion externa (timeout del motor de integracion). */
  signal?: AbortSignal;
}

export interface HttpJsonResponse {
  status: number;
  latencyMs: number;
  /** Cuerpo parseado; undefined si vino vacio. */
  body: unknown;
  /** El cuerpo no era JSON valido o excedia el limite. */
  invalidBody: boolean;
}

/**
 * CONNECT: no se pudo establecer la conexion (la operacion seguro no se ejecuto).
 * NETWORK: la conexion se corto a mitad de camino (para escrituras, el resultado es incierto).
 * TIMEOUT: no hubo respuesta a tiempo (para escrituras, el resultado es incierto).
 */
export type HttpFailureKind = 'TIMEOUT' | 'NETWORK' | 'CONNECT';

/** Puerto de red inyectable: permite probar la conectividad y los adaptadores sin red real. */
export abstract class HttpClient {
  abstract request(opts: HttpRequestOptions): Promise<HttpResponseInfo>;
  abstract requestJson(opts: HttpJsonRequest): Promise<HttpJsonResponse>;
}

export class HttpClientError extends Error {
  constructor(message: string, readonly kind: HttpFailureKind, readonly latencyMs: number) {
    super(message);
  }
}

/** Limite del cuerpo de respuesta de un proveedor: evita agotar memoria con respuestas anomalas. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

function causeCode(e: unknown): string | undefined {
  const cause = (e as { cause?: { code?: unknown } } | undefined)?.cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
}

async function readLimited(res: Response): Promise<{ text: string; tooLarge: boolean }> {
  if (!res.body) return { text: '', tooLarge: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { text: '', tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false };
}

export class FetchHttpClient extends HttpClient {
  async request(opts: HttpRequestOptions): Promise<HttpResponseInfo> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(opts.url, {
        method: opts.method,
        headers: opts.headers,
        signal: controller.signal,
        redirect: 'manual', // no se siguen redirecciones: evita saltos hacia hosts internos (SSRF)
      });
      // No se lee el cuerpo: solo interesa el estado y la latencia.
      void res.body?.cancel();
      return { status: res.status, latencyMs: Date.now() - started };
    } catch (e) {
      throw this.toError(e, controller.signal.aborted, opts.timeoutMs, Date.now() - started);
    } finally {
      clearTimeout(timer);
    }
  }

  async requestJson(opts: HttpJsonRequest): Promise<HttpJsonResponse> {
    const started = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([timeout.signal, opts.signal]) : timeout.signal;
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    let body: string | undefined;
    if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    try {
      const res = await fetch(opts.url, { method: opts.method, headers, body, signal, redirect: 'manual' });
      const { text, tooLarge } = await readLimited(res);
      let parsed: unknown;
      let invalidBody = tooLarge;
      if (!tooLarge && text.trim() !== '') {
        try {
          parsed = JSON.parse(text);
        } catch {
          invalidBody = true;
        }
      }
      return { status: res.status, latencyMs: Date.now() - started, body: parsed, invalidBody };
    } catch (e) {
      throw this.toError(e, signal.aborted, opts.timeoutMs, Date.now() - started);
    } finally {
      clearTimeout(timer);
    }
  }

  private toError(e: unknown, aborted: boolean, timeoutMs: number, latencyMs: number): HttpClientError {
    if (aborted) return new HttpClientError(`Timeout tras ${timeoutMs} ms`, 'TIMEOUT', latencyMs);
    const code = causeCode(e);
    if (code && CONNECT_ERRORS.has(code)) return new HttpClientError(`No se pudo conectar con el proveedor (${code})`, 'CONNECT', latencyMs);
    return new HttpClientError('Error de red al conectar con el proveedor', 'NETWORK', latencyMs);
  }
}
