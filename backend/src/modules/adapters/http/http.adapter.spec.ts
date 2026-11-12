import { ConfigService } from '@nestjs/config';
import { HttpClient, HttpClientError, HttpJsonRequest, HttpJsonResponse, HttpRequestOptions, HttpResponseInfo } from '../../integrations/http-client';
import { AdapterCallContext, ProviderRuntimeConfig } from '../ports/provider-adapter.port';
import { HttpProviderAdapter, mapHttpStatus } from './http.adapter';
import { OAuth2TokenProvider } from './oauth2-token.provider';

type Responder = (req: HttpJsonRequest) => HttpJsonResponse | Promise<HttpJsonResponse>;

class FakeHttp extends HttpClient {
  calls: HttpJsonRequest[] = [];
  constructor(private responder: Responder) { super(); }
  set(r: Responder) { this.responder = r; }
  async request(_o: HttpRequestOptions): Promise<HttpResponseInfo> { return { status: 200, latencyMs: 1 }; }
  async requestJson(req: HttpJsonRequest): Promise<HttpJsonResponse> {
    this.calls.push(req);
    return this.responder(req);
  }
}

const json = (status: number, body: unknown): HttpJsonResponse => ({ status, latencyMs: 5, body, invalidBody: false });

const cfg = (over: Partial<ProviderRuntimeConfig> = {}): ProviderRuntimeConfig => ({
  providerId: 'p1', providerCode: 'SKY', providerType: 'AIRLINE', baseUrl: 'http://sim.local/p/SKYJET', authType: 'NONE', credentials: null,
  timeoutMs: 1000, maxRetries: 2, retryBaseMs: 10, retryMaxMs: 50, circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000, halfOpenMaxCalls: 1 },
  supportsIdempotency: false, params: {}, ...over,
});
const ctx = (over: Partial<ProviderRuntimeConfig> = {}, extra: Partial<AdapterCallContext> = {}): AdapterCallContext =>
  ({ correlationId: 'corr-1', transactionId: 'tx-1', attempt: 1, provider: cfg(over), ...extra });

const config = { get: () => true } as unknown as ConfigService<any, true>;
const travelers = [{ firstName: 'Ana', lastName: 'Perez', documentNumber: '123' }];
const flightItem = {
  sku: 'SJ1304-20261121', type: 'flight', date: '2026-11-21', units_left: 7,
  flight: { airline: 'SJ', number: 'SJ1304', from: 'EZE', to: 'PUJ', dep: '2026-11-21T09:00:00.000Z', arr: '2026-11-21T15:00:00.000Z', cabin_class: 'Y' },
};

function setup(responder: Responder) {
  const http = new FakeHttp(responder);
  const tokens = new OAuth2TokenProvider(http, config);
  return { http, tokens, adapter: new HttpProviderAdapter(http, tokens) };
}

describe('HttpProviderAdapter', () => {
  it('normaliza disponibilidad al modelo canonico y elimina duplicados', async () => {
    const { adapter, http } = setup(() => json(200, { results: [flightItem, flightItem], generated_at: '2026-11-11T12:00:00Z' }));
    const r = await adapter.searchAvailability({ kind: 'FLIGHT', startDate: '2026-11-21', quantity: 1, origin: 'EZE' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toHaveLength(1);
    expect(r.data.items[0]).toMatchObject({
      date: '2026-11-21', availableQuantity: 7, source: 'PROVIDER_LIVE',
      product: { kind: 'FLIGHT', carrier: 'SJ', flightNumber: 'SJ1304', origin: 'EZE', destination: 'PUJ', cabin: 'ECONOMY', ref: { providerCode: 'SKY', externalId: 'SJ1304-20261121' } },
    });
    expect(r.data.items[0].product.ref.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(http.calls[0]).toMatchObject({ url: 'http://sim.local/p/SKYJET/availability', method: 'POST', json: { product_type: 'flight', date_from: '2026-11-21', units: 1, origin: 'EZE' } });
    expect(http.calls[0].headers?.['X-Correlation-Id']).toBe('corr-1');
  });

  it('respuesta con forma inesperada -> PROTOCOL_ERROR (nunca un valor por defecto)', async () => {
    const { adapter } = setup(() => json(200, { results: [{ ...flightItem, units_left: 'muchos' }] }));
    const r = await adapter.searchAvailability({ kind: 'FLIGHT', startDate: '2026-11-21', quantity: 1 }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: 'PROTOCOL_ERROR', retryable: true, outcomeUnknown: false } });
  });

  it('JSON invalido en una escritura -> resultado desconocido', async () => {
    const { adapter } = setup(() => ({ status: 200, latencyMs: 1, body: undefined, invalidBody: true }));
    const r = await adapter.confirm({ clientReference: 'i1', product: { providerCode: 'SKY', externalId: 'X' }, quantity: 1, startDate: '2026-11-21', expectedTotal: { amount: '1.00', currency: 'USD' }, travelers }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: 'PROTOCOL_ERROR', retryable: false, outcomeUnknown: true } });
  });

  it('timeout de red: reintentable en lecturas y DESCONOCIDO en escrituras', async () => {
    const { adapter } = setup(() => { throw new HttpClientError('Timeout', 'TIMEOUT', 1000); });
    const read = await adapter.getRates({ products: [{ providerCode: 'SKY', externalId: 'X' }], startDate: '2026-11-21', quantity: 1 }, ctx());
    expect(read).toMatchObject({ ok: false, error: { code: 'TIMEOUT', retryable: true, outcomeUnknown: false } });
    const write = await adapter.confirm({ clientReference: 'i1', product: { providerCode: 'SKY', externalId: 'X' }, quantity: 1, startDate: '2026-11-21', expectedTotal: { amount: '1.00', currency: 'USD' }, travelers }, ctx());
    expect(write).toMatchObject({ ok: false, error: { code: 'TIMEOUT', outcomeUnknown: true } });
  });

  it('conexion rechazada: la escritura seguro no se ejecuto (resultado conocido)', async () => {
    const { adapter } = setup(() => { throw new HttpClientError('ECONNREFUSED', 'CONNECT', 2); });
    const r = await adapter.hold({ clientReference: 'i1', product: { providerCode: 'SKY', externalId: 'X' }, quantity: 1, startDate: '2026-11-21', travelers }, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true, outcomeUnknown: false } });
  });

  it('confirmacion: mapea estado y localizador; envia Idempotency-Key solo si el proveedor la soporta', async () => {
    const { adapter, http } = setup(() => json(201, { locator: 'SKY-ABC', status: 'CONFIRMED', price: { total: '625.00', taxes: '85.00', currency: 'USD' } }));
    const req = { clientReference: 'i1', providerHoldRef: 'H-1', product: { providerCode: 'SKY', externalId: 'SJ1304-20261121' }, quantity: 1, startDate: '2026-11-21', expectedTotal: { amount: '625.00', currency: 'USD' }, travelers };
    const r = await adapter.confirm(req, ctx({}, { idempotencyKey: 'mgt-k1' }));
    expect(r).toMatchObject({ ok: true, data: { status: 'CONFIRMED', externalLocator: 'SKY-ABC', confirmedTotal: { amount: '625.00', currency: 'USD' } } });
    expect(http.calls[0].headers?.['Idempotency-Key']).toBeUndefined();
    expect(http.calls[0].json).toMatchObject({ client_ref: 'i1', hold_id: 'H-1', passengers: [{ first_name: 'Ana', last_name: 'Perez', doc_number: '123' }] });

    await adapter.confirm(req, ctx({ supportsIdempotency: true }, { idempotencyKey: 'mgt-k1' }));
    expect(http.calls[1].headers?.['Idempotency-Key']).toBe('mgt-k1');
  });

  it('CONFIRMED sin localizador no es una confirmacion valida', async () => {
    const { adapter } = setup(() => json(201, { status: 'CONFIRMED' }));
    const r = await adapter.confirm({ clientReference: 'i1', product: { providerCode: 'SKY', externalId: 'X' }, quantity: 1, startDate: '2026-11-21', expectedTotal: { amount: '1.00', currency: 'USD' }, travelers }, ctx());
    expect(r).toMatchObject({ ok: false, error: { outcomeUnknown: true } });
  });

  it('consulta de reserva: 404 explicito = no encontrada; 404 de ruta = error de configuracion', async () => {
    const { adapter, http } = setup(() => json(404, { error: { code: 'BOOKING_NOT_FOUND' } }));
    expect(await adapter.queryBooking({ clientReference: 'i1', externalLocator: 'L1' }, ctx())).toMatchObject({ ok: true, data: { found: false, status: 'UNKNOWN' } });
    http.set(() => json(404, { error: { code: 'NOT_FOUND' } }));
    expect(await adapter.queryBooking({ clientReference: 'i1' }, ctx())).toMatchObject({ ok: false, error: { code: 'PROTOCOL_ERROR' } });
    http.set(() => json(200, { bookings: [{ locator: 'A', status: 'CANCELLED' }, { locator: 'B', status: 'PENDING' }] }));
    expect(await adapter.queryBooking({ clientReference: 'i1' }, ctx())).toMatchObject({ ok: true, data: { found: true, status: 'PENDING_CONFIRMATION', externalLocator: 'B' } });
    expect(http.calls[2].url).toBe('http://sim.local/p/SKYJET/bookings?client_ref=i1');
  });

  it('autenticacion API key y cabeceras extra sin pisar las protegidas', async () => {
    const { adapter, http } = setup(() => json(200, { status: 'UP' }));
    await adapter.healthCheck(ctx({
      authType: 'API_KEY', authHeaderName: 'X-API-Key', credentials: { apiKey: 'secret-key' },
      params: { healthPath: 'ping', headers: { 'X-Agency': 'MGT', Authorization: 'hack', 'Bad Header': 'x' } },
    }));
    expect(http.calls[0].url).toBe('http://sim.local/p/SKYJET/ping');
    expect(http.calls[0].headers).toMatchObject({ 'X-API-Key': 'secret-key', 'X-Agency': 'MGT' });
    expect(http.calls[0].headers?.Authorization).toBeUndefined();
    expect(Object.keys(http.calls[0].headers ?? {})).not.toContain('Bad Header');
  });

  it('OAuth2 client_credentials: un token compartido, se reutiliza y se renueva tras un 401', async () => {
    let tokenCalls = 0;
    const { adapter, http } = setup((req) => {
      if (req.url === 'https://auth.local/token') {
        tokenCalls++;
        expect(req.form).toEqual({ grant_type: 'client_credentials' });
        expect(req.headers?.Authorization).toMatch(/^Basic /);
        return json(200, { access_token: `tok-${tokenCalls}`, token_type: 'Bearer', expires_in: 3600 });
      }
      return json(200, { status: 'UP' });
    });
    const oauth = { authType: 'OAUTH2_CLIENT' as const, credentials: { clientId: 'c', clientSecret: 's', tokenUrl: 'https://auth.local/token' } };
    await Promise.all([adapter.healthCheck(ctx(oauth)), adapter.healthCheck(ctx(oauth))]);
    expect(tokenCalls).toBe(1);
    const api = http.calls.filter((c) => c.url.endsWith('/health'));
    expect(api.every((c) => c.headers?.Authorization === 'Bearer tok-1')).toBe(true);

    http.set((req) => (req.url === 'https://auth.local/token' ? json(200, { access_token: 'tok-2', token_type: 'Bearer', expires_in: 3600 }) : json(401, {})));
    const denied = await adapter.healthCheck(ctx(oauth));
    expect(denied).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
    http.set((req) => (req.url === 'https://auth.local/token' ? json(200, { access_token: 'tok-3', token_type: 'Bearer', expires_in: 3600 }) : json(200, { status: 'UP' })));
    await adapter.healthCheck(ctx(oauth));
    expect(http.calls[http.calls.length - 1].headers?.Authorization).toBe('Bearer tok-3');
  });

  it('OAuth2 con credenciales rechazadas -> AUTH_FAILED sin llamar al proveedor', async () => {
    const { adapter, http } = setup((req) => (req.url.includes('/token') ? json(401, { error: 'invalid_client' }) : json(200, {})));
    const r = await adapter.healthCheck(ctx({ authType: 'OAUTH2_CLIENT', credentials: { clientId: 'c', clientSecret: 'bad', tokenUrl: 'https://auth.local/token' } }));
    expect(r).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
    expect(http.calls).toHaveLength(1);
  });
});

describe('mapHttpStatus', () => {
  it('traduce errores HTTP a codigos canonicos', () => {
    expect(mapHttpStatus(409, { error: { code: 'SOLD_OUT' } }, 'HOLD')).toMatchObject({ code: 'NO_AVAILABILITY', retryable: false, outcomeUnknown: false });
    expect(mapHttpStatus(409, { error: { code: 'PRICE_MISMATCH' } }, 'CONFIRM')).toMatchObject({ code: 'PRICE_CHANGED' });
    expect(mapHttpStatus(503, {}, 'SEARCH')).toMatchObject({ code: 'UNAVAILABLE', retryable: true, outcomeUnknown: false });
    expect(mapHttpStatus(503, {}, 'CONFIRM')).toMatchObject({ code: 'UNAVAILABLE', outcomeUnknown: true });
    expect(mapHttpStatus(504, {}, 'CANCEL')).toMatchObject({ code: 'TIMEOUT', outcomeUnknown: true });
    expect(mapHttpStatus(429, {}, 'HOLD')).toMatchObject({ code: 'UNAVAILABLE', retryable: true, outcomeUnknown: false });
    expect(mapHttpStatus(401, {}, 'SEARCH')).toMatchObject({ code: 'AUTH_FAILED' });
    expect(mapHttpStatus(422, {}, 'HOLD')).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
