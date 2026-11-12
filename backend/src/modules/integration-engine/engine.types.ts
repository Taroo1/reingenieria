import {
  AvailabilityQuery, AvailabilityResult, CancelRequest, CancelResult, ConfirmRequest, ConfirmResult, HoldRequest, HoldResult,
  QueryBookingRequest, QueryBookingResult, RateQuery, RateResult,
} from '../normalization/canonical';
import { OperationName } from '../adapters/adapter-errors';
import { AdapterError, HealthCheckData } from '../adapters/ports/provider-adapter.port';

export interface OperationRequests {
  HEALTH_CHECK: undefined;
  SEARCH: AvailabilityQuery;
  GET_RATES: RateQuery;
  HOLD: HoldRequest;
  CONFIRM: ConfirmRequest;
  CANCEL: CancelRequest;
  QUERY_BOOKING: QueryBookingRequest;
}

export interface OperationResults {
  HEALTH_CHECK: HealthCheckData;
  SEARCH: AvailabilityResult;
  GET_RATES: RateResult;
  HOLD: HoldResult;
  CONFIRM: ConfirmResult;
  CANCEL: CancelResult;
  QUERY_BOOKING: QueryBookingResult;
}

export interface ExecuteInput<O extends OperationName> {
  integrationId: string;
  operation: O;
  request: OperationRequests[O];
  /**
   * Obligatoria en escrituras (HOLD/CONFIRM/CANCEL): clave de negocio unica (p. ej. "<itemId>:CONFIRM:1").
   * Se persiste ANTES de llamar al proveedor; una segunda ejecucion con la misma clave no vuelve a llamar.
   */
  operationKey?: string;
  bookingItemId?: string;
}

/**
 * Codigos propios del motor (ademas del codigo canonico del error):
 *  - INTEGRATION_DISABLED: la integracion o el proveedor no estan habilitados.
 *  - NOT_CONFIGURED: falta la ficha tecnica de conexion o no puede descifrarse.
 *  - CIRCUIT_OPEN: el circuito esta abierto; la llamada no se envio.
 *  - OPERATION_IN_PROGRESS: otra ejecucion con la misma operationKey esta en curso.
 *  - OPERATION_ALREADY_EXECUTED: ya hubo una ejecucion con esa operationKey y no termino bien;
 *    se devuelve su resultado. Si outcomeUnknown, consultar al proveedor y conciliar.
 */
export type EngineCode = 'INTEGRATION_DISABLED' | 'NOT_CONFIGURED' | 'CIRCUIT_OPEN' | 'OPERATION_IN_PROGRESS' | 'OPERATION_ALREADY_EXECUTED';

export interface EngineError extends AdapterError {
  engineCode?: EngineCode;
  /** Con CIRCUIT_OPEN: cuando se permitira la proxima llamada de prueba. */
  retryAt?: string;
}

export type EngineResult<T> =
  | { ok: true; data: T; httpStatus?: number; transactionId: string; attempts: number; latencyMs: number; replayed: boolean }
  | { ok: false; error: EngineError; transactionId: string | null; attempts: number; latencyMs: number };
