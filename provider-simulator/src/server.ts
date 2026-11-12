import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { FaultBook, FaultRule, FaultValidationError, parseRules, RouteName, WRITE_ROUTES } from './faults';
import { ProviderRuntime, SimResponse, SimState } from './state';
import { isRecord, parseDate, parseMoneyCents } from './util';

export interface SimulatorConfig {
  /** Token de la API de control. Sin token, la API de control queda deshabilitada. */
  adminToken?: string;
  /** Si se define, las rutas de proveedor exigen la cabecera X-API-Key. */
  apiKey?: string;
  holdTtlMs: number;
  /** Tiempo maximo que se retiene una conexion en las fallas de timeout. */
  hangMaxMs: number;
  log?: (msg: string) => void;
}

const MAX_BODY_BYTES = 256 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'el cuerpo no es JSON valido'));
      }
    });
    req.on('error', reject);
  });
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** Retiene la conexion sin responder hasta que el cliente se rinda (o hangMaxMs). */
function hang(res: ServerResponse, maxMs: number): void {
  const t = setTimeout(() => res.destroy(), maxMs);
  res.on('close', () => clearTimeout(t));
}

function duplicateLists(body: unknown): unknown {
  if (!isRecord(body)) return body;
  const out: Record<string, unknown> = { ...body };
  for (const k of ['results', 'offers', 'bookings']) {
    if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).flatMap((x) => [x, x]);
  }
  return out;
}

export class SimulatorServer {
  readonly state: SimState;
  readonly faults = new FaultBook();
  private readonly server: Server;

  constructor(private readonly config: SimulatorConfig, state?: SimState) {
    this.state = state ?? new SimState(config.holdTtlMs);
    this.server = createServer((req, res) => {
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      this.handle(req, res, abort.signal).catch((e: unknown) => {
        if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
        this.config.log?.(`error interno: ${(e as Error).message}`);
        send(res, 500, { error: { code: 'INTERNAL', message: 'error interno del simulador' } });
      });
    });
    this.server.keepAliveTimeout = 5_000;
  }

  listen(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        const addr = this.server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse, signal: AbortSignal): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://simulator.local');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
      return send(res, 200, { status: 'UP', service: 'provider-simulator', providers: this.state.providerCodes() });
    }
    if (parts[0] === '__control') return this.control(req, res, parts.slice(1), method, url);
    if (parts[0] === 'p' && parts[1]) return this.provider(req, res, parts[1], parts.slice(2), method, url, signal);
    throw new HttpError(404, 'NOT_FOUND', 'ruta inexistente');
  }

  // ---------------- API de proveedor ----------------

  private resolveRoute(rest: string[], method: string): { route: RouteName; locator?: string } | null {
    const [a, b, c] = rest;
    if (rest.length === 1 && a === 'health' && method === 'GET') return { route: 'health' };
    if (rest.length === 1 && a === 'availability' && method === 'POST') return { route: 'availability' };
    if (rest.length === 1 && a === 'rates' && method === 'POST') return { route: 'rates' };
    if (rest.length === 1 && a === 'holds' && method === 'POST') return { route: 'holds' };
    if (rest.length === 1 && a === 'bookings' && method === 'POST') return { route: 'bookings' };
    if (rest.length === 1 && a === 'bookings' && method === 'GET') return { route: 'query' };
    if (rest.length === 2 && a === 'bookings' && method === 'GET') return { route: 'query', locator: b };
    if (rest.length === 3 && a === 'bookings' && c === 'cancel' && method === 'POST') return { route: 'cancel', locator: b };
    return null;
  }

  private async provider(req: IncomingMessage, res: ServerResponse, code: string, rest: string[], method: string, url: URL, signal: AbortSignal): Promise<void> {
    const rt = this.state.runtime(code);
    if (!rt) throw new HttpError(404, 'PROVIDER_NOT_FOUND', `proveedor ${code} inexistente`);
    const resolved = this.resolveRoute(rest, method);
    if (!resolved) throw new HttpError(404, 'NOT_FOUND', 'ruta inexistente');
    const { route, locator } = resolved;
    rt.requests[route] = (rt.requests[route] ?? 0) + 1;

    if (this.config.apiKey) {
      const given = req.headers['x-api-key'];
      if (typeof given !== 'string' || !safeEqual(given, this.config.apiKey)) {
        return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'X-API-Key invalida' } });
      }
    }
    const body = method === 'POST' ? await readJson(req) : undefined;

    const fault = this.faults.take(code, route);
    if (fault) this.config.log?.(`falla ${fault.type} en ${code}/${route}`);
    const delay = fault?.latency_ms ?? 0;
    if (delay > 0) await sleep(delay, signal);
    if (signal.aborted) return;

    if (fault?.type === 'error') return send(res, fault.status ?? 503, { error: { code: 'SIMULATED_FAILURE', message: 'falla simulada del proveedor' } });
    if (fault?.type === 'timeout') return hang(res, this.config.hangMaxMs);
    if (fault?.type === 'malformed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"results": [{"sku": ');
      return;
    }

    const isWrite = WRITE_ROUTES.includes(route);
    const idemKey = isWrite ? req.headers['idempotency-key'] : undefined;
    const fingerprint = JSON.stringify({ route, locator, body });
    if (typeof idemKey === 'string' && idemKey.length > 0) {
      const replay = this.state.idempotencyLookup(rt, route, idemKey, fingerprint);
      if (replay === 'MISMATCH') {
        return send(res, 422, { error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'la clave de idempotencia ya se uso con otra solicitud' } });
      }
      if (replay) return this.respond(res, replay, fault, { 'Idempotent-Replayed': 'true' });
    }

    const result = this.execute(rt, route, body, locator, url);
    if (typeof idemKey === 'string' && idemKey.length > 0) this.state.idempotencyStore(rt, route, idemKey, fingerprint, result);
    return this.respond(res, result, fault);
  }

  private respond(res: ServerResponse, result: SimResponse, fault: FaultRule | null, headers: Record<string, string> = {}): void {
    if (fault?.type === 'commit_then_error') {
      return send(res, fault.status ?? 503, { error: { code: 'SIMULATED_FAILURE', message: 'falla simulada despues de procesar' } });
    }
    if (fault?.type === 'commit_then_timeout') return hang(res, this.config.hangMaxMs);
    const body = fault?.type === 'duplicate' ? duplicateLists(result.body) : result.body;
    send(res, result.status, body, headers);
  }

  private execute(rt: ProviderRuntime, route: RouteName, body: unknown, locator: string | undefined, url: URL): SimResponse {
    switch (route) {
      case 'health':
        return { status: 200, body: { status: 'UP', provider: rt.def.code, kind: rt.def.kind } };
      case 'availability':
        return this.state.availability(rt, body);
      case 'rates':
        return this.state.rates(rt, body);
      case 'holds':
        return this.state.createHold(rt, body);
      case 'bookings':
        return this.state.createBooking(rt, body);
      case 'cancel':
        return this.state.cancelBooking(rt, locator!, body);
      case 'query': {
        if (locator) return this.state.getBooking(rt, locator);
        const clientRef = url.searchParams.get('client_ref');
        if (!clientRef) return { status: 400, body: { error: { code: 'INVALID_REQUEST', message: 'client_ref requerido' } } };
        return this.state.queryBookings(rt, clientRef);
      }
    }
  }

  // ---------------- API de control (pruebas) ----------------

  private async control(req: IncomingMessage, res: ServerResponse, parts: string[], method: string, url: URL): Promise<void> {
    if (!this.config.adminToken) throw new HttpError(403, 'CONTROL_DISABLED', 'defina SIMULATOR_ADMIN_TOKEN para habilitar la API de control');
    const given = req.headers['x-simulator-admin-token'];
    if (typeof given !== 'string' || !safeEqual(given, this.config.adminToken)) throw new HttpError(401, 'UNAUTHORIZED', 'token de control invalido');
    const [action] = parts;
    const body = method === 'POST' ? await readJson(req) : undefined;

    if (action === 'faults' && method === 'GET') return send(res, 200, { faults: this.faults.snapshot() });
    if (action === 'faults' && method === 'DELETE') {
      this.faults.clear();
      return send(res, 200, { cleared: true });
    }
    if (action === 'faults' && method === 'POST') {
      if (!isRecord(body) || typeof body.provider !== 'string') throw new HttpError(400, 'INVALID_REQUEST', 'provider requerido ("*" para todos)');
      if (body.provider !== '*' && !this.state.runtime(body.provider)) throw new HttpError(404, 'PROVIDER_NOT_FOUND', 'proveedor inexistente');
      try {
        this.faults.set(body.provider, parseRules(body.rules));
      } catch (e) {
        if (e instanceof FaultValidationError) throw new HttpError(400, 'INVALID_RULES', e.message);
        throw e;
      }
      return send(res, 200, { faults: this.faults.snapshot() });
    }
    if (action === 'reset' && method === 'POST') {
      this.faults.clear();
      this.state.reset();
      return send(res, 200, { reset: true });
    }
    if (action === 'stats' && method === 'GET') {
      const only = url.searchParams.get('provider');
      const codes = only ? [only] : this.state.providerCodes();
      const out: Record<string, unknown> = {};
      for (const c of codes) {
        const rt = this.state.runtime(c);
        if (rt) out[c] = this.state.stats(rt);
      }
      return send(res, 200, { stats: out });
    }
    if (action === 'inventory' && method === 'POST') {
      const rt = isRecord(body) && typeof body.provider === 'string' ? this.state.runtime(body.provider) : null;
      if (!rt || !isRecord(body)) throw new HttpError(404, 'PROVIDER_NOT_FOUND', 'proveedor inexistente');
      const units = body.units;
      if (typeof body.sku !== 'string' || !parseDate(body.date) || typeof units !== 'number' || !Number.isInteger(units) || units < 0) {
        throw new HttpError(400, 'INVALID_REQUEST', 'sku, date (YYYY-MM-DD) y units (entero >= 0) requeridos');
      }
      if (!this.state.setInventory(rt, body.sku, body.date as string, units)) throw new HttpError(404, 'SKU_NOT_FOUND', 'sku inexistente o sin inventario');
      return send(res, 200, { sku: body.sku, date: body.date, units });
    }
    if (action === 'price' && method === 'POST') {
      const rt = isRecord(body) && typeof body.provider === 'string' ? this.state.runtime(body.provider) : null;
      if (!rt || !isRecord(body) || typeof body.sku !== 'string') throw new HttpError(400, 'INVALID_REQUEST', 'provider y sku requeridos');
      if (body.unit_amount === null) {
        rt.priceOverrides.delete(body.sku);
        return send(res, 200, { sku: body.sku, unit_amount: null });
      }
      const cents = parseMoneyCents(body.unit_amount);
      if (cents === null) throw new HttpError(400, 'INVALID_REQUEST', 'unit_amount debe ser un importe decimal ("123.45") o null');
      rt.priceOverrides.set(body.sku, cents);
      return send(res, 200, { sku: body.sku, unit_amount: body.unit_amount });
    }
    throw new HttpError(404, 'NOT_FOUND', 'accion de control inexistente');
  }
}
