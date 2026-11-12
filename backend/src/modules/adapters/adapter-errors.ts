import { AdapterError, AdapterResult, ProviderErrorCode } from './ports/provider-adapter.port';

export type OperationName = 'HEALTH_CHECK' | 'SEARCH' | 'GET_RATES' | 'HOLD' | 'CONFIRM' | 'CANCEL' | 'QUERY_BOOKING';

/** Operaciones que mutan estado en el proveedor (coincide con WRITE_OPERATIONS del puerto). */
export const isWriteOperation = (op: OperationName): boolean => op === 'HOLD' || op === 'CONFIRM' || op === 'CANCEL';

export function adapterError(
  code: ProviderErrorCode,
  message: string,
  opts: { retryable?: boolean; outcomeUnknown?: boolean; httpStatus?: number; providerCode?: string; raw?: unknown } = {},
): AdapterError {
  return {
    code,
    message,
    retryable: opts.retryable ?? false,
    outcomeUnknown: opts.outcomeUnknown ?? false,
    ...(opts.httpStatus !== undefined && { httpStatus: opts.httpStatus }),
    ...(opts.providerCode !== undefined && { providerCode: opts.providerCode }),
    ...(opts.raw !== undefined && { raw: opts.raw }),
  };
}

export const fail = <T>(error: AdapterError): AdapterResult<T> => ({ ok: false, error });
export const ok = <T>(data: T, extra: { httpStatus?: number; raw?: unknown } = {}): AdapterResult<T> => ({ ok: true, data, ...extra });

/** Errores que reflejan la salud del proveedor (cuentan para el circuit breaker). Los de negocio no. */
export function countsAsProviderFailure(code: ProviderErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'UNAVAILABLE' || code === 'PROTOCOL_ERROR' || code === 'UNKNOWN' || code === 'AUTH_FAILED';
}

/** Rechazo de negocio definitivo: el proveedor respondio y dijo que no. */
export function isBusinessRejection(code: ProviderErrorCode): boolean {
  return code === 'NO_AVAILABILITY' || code === 'PRICE_CHANGED' || code === 'REJECTED' || code === 'INVALID_REQUEST';
}

/** Error al validar la forma de la respuesta de un proveedor. */
export class ProtocolError extends Error {}
