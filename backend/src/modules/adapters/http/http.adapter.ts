import { Injectable } from '@nestjs/common';
import {
  AvailabilityQuery, AvailabilityResult, CancelRequest, CancelResult, ConfirmRequest, ConfirmResult, HoldRequest, HoldResult,
  QueryBookingRequest, QueryBookingResult, RateQuery, RateResult,
} from '../../normalization/canonical';
import { HttpClient, HttpClientError, HttpJsonResponse } from '../../integrations/http-client';
import { buildAuthHeaders, isValidHeaderName } from '../../providers/provider-auth.util';
import { adapterError, fail, isWriteOperation, ok, OperationName, ProtocolError } from '../adapter-errors';
import { AdapterCallContext, AdapterError, AdapterResult, HealthCheckData, ProviderAdapter } from '../ports/provider-adapter.port';
import * as wire from './http-wire';
import { OAuth2TokenProvider, TokenError } from './oauth2-token.provider';

/** Cabeceras que la configuracion libre (params.headers) no puede pisar. */
const PROTECTED_HEADERS = new Set(['authorization', 'host', 'content-length', 'content-type', 'idempotency-key', 'x-correlation-id', 'cookie', 'connection', 'transfer-encoding']);

type Raw = { ok: true; res: HttpJsonResponse } | { ok: false; error: AdapterError };

/**
 * Traduce un codigo HTTP de error a AdapterError.
 * En escrituras, un 5xx o un timeout dejan el resultado DESCONOCIDO: el proveedor pudo haber ejecutado la operacion.
 */
export function mapHttpStatus(status: number, body: unknown, op: OperationName): AdapterError {
  const write = isWriteOperation(op);
  const { code, message } = wire.errorCodeOf(body);
  const detail = message ? `: ${message}` : '';
  const base = { httpStatus: status, providerCode: code };
  if (status === 401 || status === 403) return adapterError('AUTH_FAILED', `El proveedor rechazo las credenciales (HTTP ${status})`, base);
  if (status === 409) return adapterError(wire.mapBusinessCode(code), `El proveedor rechazo la operacion${detail}`, { ...base, raw: body });
  if (status === 408 || status === 504) return adapterError('TIMEOUT', `El proveedor no respondio a tiempo (HTTP ${status})`, { ...base, retryable: true, outcomeUnknown: write });
  if (status === 429) return adapterError('UNAVAILABLE', 'El proveedor limito las peticiones (HTTP 429)', { ...base, retryable: true });
  if (status >= 500) return adapterError('UNAVAILABLE', `El proveedor respondio HTTP ${status}`, { ...base, retryable: true, outcomeUnknown: write });
  if (status === 404) return adapterError('PROTOCOL_ERROR', 'Ruta inexistente en el proveedor (HTTP 404): revise la baseUrl', base);
  if (status >= 400) return adapterError('INVALID_REQUEST', `El proveedor rechazo la solicitud (HTTP ${status})${detail}`, base);
  return adapterError('UNKNOWN', `Respuesta HTTP inesperada ${status}`, { ...base, outcomeUnknown: write });
}

@Injectable()
export class HttpProviderAdapter implements ProviderAdapter {
  readonly kind = 'HTTP' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly tokens: OAuth2TokenProvider,
  ) {}

  private async headers(ctx: AdapterCallContext, op: OperationName): Promise<Record<string, string>> {
    const cfg = ctx.provider;
    const h: Record<string, string> = { 'X-Correlation-Id': ctx.correlationId };
    const extra = cfg.params['headers'];
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
        if (typeof v === 'string' && isValidHeaderName(k) && !PROTECTED_HEADERS.has(k.toLowerCase())) h[k] = v;
      }
    }
    if (cfg.authType === 'OAUTH2_CLIENT') h.Authorization = `Bearer ${await this.tokens.getToken(cfg, ctx.signal)}`;
    else Object.assign(h, buildAuthHeaders(cfg.authType, cfg.authHeaderName, cfg.credentials));
    if (isWriteOperation(op) && cfg.supportsIdempotency && ctx.idempotencyKey) h['Idempotency-Key'] = ctx.idempotencyKey;
    return h;
  }

  private async send(ctx: AdapterCallContext, op: OperationName, method: 'GET' | 'POST', path: string, json?: unknown): Promise<Raw> {
    const write = isWriteOperation(op);
    let headers: Record<string, string>;
    try {
      headers = await this.headers(ctx, op);
    } catch (e) {
      if (e instanceof TokenError) return { ok: false, error: e.error };
      throw e;
    }
    try {
      const res = await this.http.requestJson({ url: `${ctx.provider.baseUrl}${path}`, method, headers, json, timeoutMs: ctx.provider.timeoutMs, signal: ctx.signal });
      if (res.status === 401 && ctx.provider.authType === 'OAUTH2_CLIENT') this.tokens.invalidate(ctx.provider);
      return { ok: true, res };
    } catch (e) {
      if (!(e instanceof HttpClientError)) throw e;
      if (e.kind === 'TIMEOUT') return { ok: false, error: adapterError('TIMEOUT', e.message, { retryable: true, outcomeUnknown: write }) };
      if (e.kind === 'CONNECT') return { ok: false, error: adapterError('UNAVAILABLE', e.message, { retryable: true }) };
      return { ok: false, error: adapterError('UNAVAILABLE', e.message, { retryable: true, outcomeUnknown: write }) };
    }
  }

  /** Respuesta 2xx con cuerpo valido -> parse; cualquier otra cosa -> AdapterError. */
  private async exchange<T>(ctx: AdapterCallContext, op: OperationName, method: 'GET' | 'POST', path: string, json: unknown, parse: (body: unknown) => T): Promise<AdapterResult<T>> {
    const raw = await this.send(ctx, op, method, path, json);
    if (!raw.ok) return fail(raw.error);
    const { res } = raw;
    if (res.status < 200 || res.status >= 300) return fail(mapHttpStatus(res.status, res.body, op));
    return this.parsed(res, op, parse);
  }

  private parsed<T>(res: HttpJsonResponse, op: OperationName, parse: (body: unknown) => T): AdapterResult<T> {
    const write = isWriteOperation(op);
    // Un 2xx ilegible en una escritura significa que el proveedor probablemente la ejecuto.
    if (res.invalidBody) return fail(adapterError('PROTOCOL_ERROR', 'Respuesta del proveedor no es JSON valido', { httpStatus: res.status, retryable: !write, outcomeUnknown: write }));
    try {
      return ok(parse(res.body), { httpStatus: res.status, raw: res.body });
    } catch (e) {
      if (e instanceof ProtocolError) {
        return fail(adapterError('PROTOCOL_ERROR', `Respuesta del proveedor con formato inesperado: ${e.message}`, { httpStatus: res.status, retryable: !write, outcomeUnknown: write }));
      }
      throw e;
    }
  }

  async healthCheck(ctx: AdapterCallContext): Promise<AdapterResult<HealthCheckData>> {
    const raw = ctx.provider.params['healthPath'];
    const path = typeof raw === 'string' && raw.length > 0 ? (raw.startsWith('/') ? raw : `/${raw}`) : '/health';
    const res = await this.send(ctx, 'HEALTH_CHECK', 'GET', path);
    if (!res.ok) return fail(res.error);
    if (res.res.status < 200 || res.res.status >= 300) return fail(mapHttpStatus(res.res.status, res.res.body, 'HEALTH_CHECK'));
    return ok({ reachable: true, latencyMs: res.res.latencyMs, detail: 'OK' }, { httpStatus: res.res.status });
  }

  searchAvailability(query: AvailabilityQuery, ctx: AdapterCallContext): Promise<AdapterResult<AvailabilityResult>> {
    return this.exchange(ctx, 'SEARCH', 'POST', '/availability', wire.availabilityRequest(query), (b) => wire.parseAvailability(b, query, ctx.provider.providerCode));
  }

  getRates(query: RateQuery, ctx: AdapterCallContext): Promise<AdapterResult<RateResult>> {
    return this.exchange(ctx, 'GET_RATES', 'POST', '/rates', wire.ratesRequest(query), (b) => wire.parseRates(b, ctx.provider.providerCode));
  }

  hold(request: HoldRequest, ctx: AdapterCallContext): Promise<AdapterResult<HoldResult>> {
    return this.exchange(ctx, 'HOLD', 'POST', '/holds', wire.holdRequest(request), wire.parseHold);
  }

  async confirm(request: ConfirmRequest, ctx: AdapterCallContext): Promise<AdapterResult<ConfirmResult>> {
    const r = await this.exchange(ctx, 'CONFIRM', 'POST', '/bookings', wire.confirmRequest(request), wire.parseConfirm);
    // Un CONFIRMED sin localizador no es una confirmacion valida: se trata como resultado desconocido.
    if (r.ok && r.data.status === 'CONFIRMED' && !r.data.externalLocator) {
      return fail(adapterError('PROTOCOL_ERROR', 'El proveedor informo CONFIRMED sin localizador', { outcomeUnknown: true }));
    }
    return r;
  }

  cancel(request: CancelRequest, ctx: AdapterCallContext): Promise<AdapterResult<CancelResult>> {
    return this.exchange(ctx, 'CANCEL', 'POST', `/bookings/${encodeURIComponent(request.externalLocator)}/cancel`, wire.cancelRequest(request), wire.parseCancel);
  }

  async queryBooking(request: QueryBookingRequest, ctx: AdapterCallContext): Promise<AdapterResult<QueryBookingResult>> {
    const path = request.externalLocator
      ? `/bookings/${encodeURIComponent(request.externalLocator)}`
      : `/bookings?client_ref=${encodeURIComponent(request.clientReference)}`;
    const raw = await this.send(ctx, 'QUERY_BOOKING', 'GET', path);
    if (!raw.ok) return fail(raw.error);
    // Solo un "no existe la reserva" explicito cuenta como no encontrada; un 404 de ruta es un error de configuracion.
    if (raw.res.status === 404 && wire.errorCodeOf(raw.res.body).code === 'BOOKING_NOT_FOUND') {
      return ok({ found: false, status: 'UNKNOWN' }, { httpStatus: 404 });
    }
    if (raw.res.status < 200 || raw.res.status >= 300) return fail(mapHttpStatus(raw.res.status, raw.res.body, 'QUERY_BOOKING'));
    return this.parsed(raw.res, 'QUERY_BOOKING', (b) => wire.parseQuery(b, request.externalLocator));
  }
}
