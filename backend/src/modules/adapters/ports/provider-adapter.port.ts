/**
 * CONTRATO CONGELADO (Etapa 2): puerto ProviderAdapter.
 * Es el unico punto por el que el dominio habla con un proveedor. Lo implementan, con el mismo contrato,
 * el adaptador simulado, el adaptador HTTP y el adaptador Boomi (Etapa 3), y lo implementara cualquier
 * proveedor real. Cualquier cambio exige analizar el impacto en todas las implementaciones.
 */
import {
  AvailabilityQuery,
  AvailabilityResult,
  CancelRequest,
  CancelResult,
  ConfirmRequest,
  ConfirmResult,
  HoldRequest,
  HoldResult,
  QueryBookingRequest,
  QueryBookingResult,
  RateQuery,
  RateResult,
} from '../../normalization/canonical';

export type AdapterKindName = 'SIMULATED' | 'HTTP' | 'BOOMI';
export type AuthTypeName = 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC' | 'OAUTH2_CLIENT';

export interface ProviderCredentials {
  apiKey?: string;
  token?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

/** Configuracion de conexion ya descifrada. Solo existe en memoria, nunca se registra ni se devuelve por la API. */
export interface ProviderRuntimeConfig {
  providerId: string;
  providerCode: string;
  providerType: string;
  baseUrl: string;
  authType: AuthTypeName;
  authHeaderName?: string;
  credentials: ProviderCredentials | null;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  circuitBreaker: { failureThreshold: number; resetTimeoutMs: number; halfOpenMaxCalls: number };
  supportsIdempotency: boolean;
  /** Parametros libres de la ficha tecnica (healthPath, rutas, cabeceras extra...). */
  params: Record<string, unknown>;
}

export interface AdapterCallContext {
  correlationId: string;
  transactionId: string;
  attempt: number;
  /** Solo se envia al proveedor si supportsIdempotency es true. */
  idempotencyKey?: string;
  provider: ProviderRuntimeConfig;
  signal?: AbortSignal;
}

export type ProviderErrorCode =
  | 'AUTH_FAILED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'NO_AVAILABILITY'
  | 'PRICE_CHANGED'
  | 'INVALID_REQUEST'
  | 'REJECTED'
  | 'PROTOCOL_ERROR'
  | 'UNKNOWN';

export interface AdapterError {
  code: ProviderErrorCode;
  message: string;
  /** Se puede reintentar sin riesgo de duplicar la operacion. */
  retryable: boolean;
  /**
   * El proveedor pudo haber ejecutado la operacion aunque no tengamos respuesta (timeout al confirmar).
   * Si es true NO se reintenta a ciegas: se consulta el estado y se concilia.
   */
  outcomeUnknown: boolean;
  httpStatus?: number;
  providerCode?: string;
  raw?: unknown;
}

export type AdapterResult<T> =
  | { ok: true; data: T; httpStatus?: number; raw?: unknown }
  | { ok: false; error: AdapterError };

export interface HealthCheckData {
  reachable: boolean;
  latencyMs: number;
  detail?: string;
}

export interface ProviderAdapter {
  readonly kind: AdapterKindName;

  healthCheck(ctx: AdapterCallContext): Promise<AdapterResult<HealthCheckData>>;
  searchAvailability(query: AvailabilityQuery, ctx: AdapterCallContext): Promise<AdapterResult<AvailabilityResult>>;
  getRates(query: RateQuery, ctx: AdapterCallContext): Promise<AdapterResult<RateResult>>;
  hold(request: HoldRequest, ctx: AdapterCallContext): Promise<AdapterResult<HoldResult>>;
  confirm(request: ConfirmRequest, ctx: AdapterCallContext): Promise<AdapterResult<ConfirmResult>>;
  cancel(request: CancelRequest, ctx: AdapterCallContext): Promise<AdapterResult<CancelResult>>;
  queryBooking(request: QueryBookingRequest, ctx: AdapterCallContext): Promise<AdapterResult<QueryBookingResult>>;
}

/** Operaciones que mutan estado en el proveedor: nunca se reintentan a ciegas. */
export const WRITE_OPERATIONS = ['HOLD', 'CONFIRM', 'CANCEL'] as const;
