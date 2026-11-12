import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../common/config/env.validation';
import { HttpClient, HttpClientError } from '../../integrations/http-client';
import { ProviderUrlError, validateProviderUrl } from '../../providers/provider-url.util';
import { adapterError } from '../adapter-errors';
import { AdapterError, ProviderRuntimeConfig } from '../ports/provider-adapter.port';

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Margen para renovar antes del vencimiento informado por el servidor de autorizacion. */
const RENEW_MARGIN_MS = 30_000;
const MIN_LIFETIME_MS = 10_000;

export class TokenError extends Error {
  constructor(readonly error: AdapterError) {
    super(error.message);
  }
}

/**
 * OAuth2 client_credentials (RFC 6749 4.4) con client_secret_basic. El token vive solo en memoria,
 * se reutiliza hasta poco antes de vencer y se descarta si el proveedor lo rechaza (401).
 * Peticiones concurrentes comparten una unica solicitud de token.
 */
@Injectable()
export class OAuth2TokenProvider {
  private readonly cache = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly http: HttpClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Reloj (sobrescribible en pruebas). */
  protected clock(): number {
    return Date.now();
  }

  private key(cfg: ProviderRuntimeConfig): string {
    return `${cfg.providerId}|${cfg.credentials?.clientId ?? ''}`;
  }

  async getToken(cfg: ProviderRuntimeConfig, signal?: AbortSignal): Promise<string> {
    const key = this.key(cfg);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.clock()) return cached.token;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.fetchToken(cfg, signal).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  invalidate(cfg: ProviderRuntimeConfig): void {
    this.cache.delete(this.key(cfg));
  }

  private async fetchToken(cfg: ProviderRuntimeConfig, signal?: AbortSignal): Promise<string> {
    const c = cfg.credentials;
    if (!c?.clientId || !c.clientSecret || !c.tokenUrl) {
      throw new TokenError(adapterError('AUTH_FAILED', 'Faltan clientId, clientSecret o tokenUrl para OAuth2'));
    }
    let tokenUrl: string;
    try {
      tokenUrl = validateProviderUrl(c.tokenUrl, this.config.get('ALLOW_INSECURE_PROVIDER_URLS'));
    } catch (e) {
      if (e instanceof ProviderUrlError) throw new TokenError(adapterError('AUTH_FAILED', `tokenUrl invalida: ${e.message}`));
      throw e;
    }
    const scope = typeof cfg.params['oauthScope'] === 'string' ? (cfg.params['oauthScope'] as string) : undefined;
    const basic = Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`, 'utf8').toString('base64');
    let res;
    try {
      res = await this.http.requestJson({
        url: tokenUrl,
        method: 'POST',
        headers: { Authorization: `Basic ${basic}` },
        form: { grant_type: 'client_credentials', ...(scope && { scope }) },
        timeoutMs: cfg.timeoutMs,
        signal,
      });
    } catch (e) {
      const kind = e instanceof HttpClientError ? e.kind : 'NETWORK';
      throw new TokenError(adapterError(kind === 'TIMEOUT' ? 'TIMEOUT' : 'UNAVAILABLE', 'No se pudo obtener el token OAuth2', { retryable: true }));
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new TokenError(adapterError('AUTH_FAILED', `El servidor de autorizacion rechazo las credenciales (HTTP ${res.status})`, { httpStatus: res.status }));
    }
    if (res.status < 200 || res.status >= 300) {
      throw new TokenError(adapterError('UNAVAILABLE', `El servidor de autorizacion respondio HTTP ${res.status}`, { retryable: res.status >= 500, httpStatus: res.status }));
    }
    const body = res.body as Record<string, unknown> | undefined;
    const token = body?.access_token;
    const type = body?.token_type;
    if (res.invalidBody || typeof token !== 'string' || token.length === 0 || (typeof type === 'string' && type.toLowerCase() !== 'bearer')) {
      throw new TokenError(adapterError('PROTOCOL_ERROR', 'Respuesta de token OAuth2 invalida'));
    }
    const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0 ? body.expires_in * 1000 : 300_000;
    const lifetime = Math.max(MIN_LIFETIME_MS, expiresIn - RENEW_MARGIN_MS);
    this.cache.set(this.key(cfg), { token, expiresAt: this.clock() + lifetime });
    return token;
  }
}
