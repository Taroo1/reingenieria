import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { Errors } from '../../common/errors/app.exception';
import { AvailabilityQuery, CancelRequest, ConfirmRequest, HoldRequest, QueryBookingRequest, RateQuery } from '../normalization/canonical';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { adapterError, countsAsProviderFailure, isBusinessRejection, isWriteOperation, OperationName } from '../adapters/adapter-errors';
import { AdapterCallContext, AdapterError, AdapterResult, ProviderAdapter, ProviderRuntimeConfig } from '../adapters/ports/provider-adapter.port';
import { SystemLogService } from '../audit/system-log.service';
import { TransactionHandle, TransactionsService } from '../audit/transactions.service';
import { ProvidersService } from '../providers/providers.service';
import { BreakerConfig } from './circuit-breaker';
import { CircuitBreakerService } from './circuit-breaker.service';
import { EngineCode, EngineError, EngineResult, ExecuteInput, OperationRequests, OperationResults } from './engine.types';
import { backoffDelay, shouldRetry } from './retry-policy';

type IntegrationRow = Prisma.IntegrationGetPayload<{ include: { provider: true } }>;

/** Valores por defecto de la ficha tecnica (los mismos de la base) para adaptadores sin red. */
function defaultRuntimeConfig(p: { id: string; code: string; type: string }): ProviderRuntimeConfig {
  return {
    providerId: p.id, providerCode: p.code, providerType: p.type, baseUrl: '', authType: 'NONE', credentials: null,
    timeoutMs: 8000, maxRetries: 3, retryBaseMs: 200, retryMaxMs: 5000,
    circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000, halfOpenMaxCalls: 1 }, supportsIdempotency: false, params: {},
  };
}

/** Tiempo maximo que puede durar una ejecucion completa (todos los intentos y esperas). */
function maxExecutionMs(cfg: ProviderRuntimeConfig): number {
  return cfg.timeoutMs * (cfg.maxRetries + 1) + cfg.retryMaxMs * cfg.maxRetries + cfg.retryBaseMs * (cfg.maxRetries + 1);
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

function txStatusOf(error: AdapterError): TransactionStatus {
  if (error.code === 'TIMEOUT') return TransactionStatus.TIMEOUT;
  if (isBusinessRejection(error.code)) return TransactionStatus.REJECTED;
  return TransactionStatus.FAILED;
}

/** Error sin el payload crudo del proveedor (va a la base y a las respuestas). */
const publicError = ({ raw: _raw, ...e }: EngineError): EngineError => e;

/**
 * Motor de integracion: UNICO camino por el que el dominio llama a un proveedor.
 * Por cada llamada: verifica habilitacion, deduplica escrituras por operationKey (persistida antes de llamar),
 * consulta el circuit breaker, aplica timeout por intento, reintenta solo lo seguro con backoff exponencial
 * + jitter, registra transaccion e intentos con el correlationId, actualiza el circuito y deja log de fallas.
 */
@Injectable()
export class IntegrationEngine {
  private readonly logger = new Logger(IntegrationEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AdapterRegistry,
    private readonly providers: ProvidersService,
    private readonly transactions: TransactionsService,
    private readonly breaker: CircuitBreakerService,
    private readonly systemLog: SystemLogService,
  ) {}

  /** Integracion habilitada para operar con un proveedor activo (la actualizada mas recientemente). */
  resolveForProvider(providerId: string) {
    return this.prisma.integration.findFirst({
      where: { providerId, enabled: true, provider: { active: true } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, adapterKind: true },
    });
  }

  // ---------------- API tipada ----------------

  healthCheck(integrationId: string) {
    return this.execute({ integrationId, operation: 'HEALTH_CHECK', request: undefined });
  }
  /** bookingItemId vincula la llamada a un item (p. ej. revalidacion antes de confirmar) para la trazabilidad. */
  search(integrationId: string, request: AvailabilityQuery, bookingItemId?: string) {
    return this.execute({ integrationId, operation: 'SEARCH', request, bookingItemId });
  }
  getRates(integrationId: string, request: RateQuery, bookingItemId?: string) {
    return this.execute({ integrationId, operation: 'GET_RATES', request, bookingItemId });
  }
  hold(integrationId: string, request: HoldRequest, operationKey: string, bookingItemId?: string) {
    return this.execute({ integrationId, operation: 'HOLD', request, operationKey, bookingItemId });
  }
  confirm(integrationId: string, request: ConfirmRequest, operationKey: string, bookingItemId?: string) {
    return this.execute({ integrationId, operation: 'CONFIRM', request, operationKey, bookingItemId });
  }
  cancel(integrationId: string, request: CancelRequest, operationKey: string, bookingItemId?: string) {
    return this.execute({ integrationId, operation: 'CANCEL', request, operationKey, bookingItemId });
  }
  queryBooking(integrationId: string, request: QueryBookingRequest, bookingItemId?: string) {
    return this.execute({ integrationId, operation: 'QUERY_BOOKING', request, bookingItemId });
  }

  // ---------------- ejecucion ----------------

  async execute<O extends OperationName>(input: ExecuteInput<O>): Promise<EngineResult<OperationResults[O]>> {
    const started = Date.now();
    const op = input.operation;
    const write = isWriteOperation(op);
    const isHealth = op === 'HEALTH_CHECK';
    if (write && !input.operationKey) throw new Error(`operationKey es obligatoria para ${op}`);

    const integration = await this.prisma.integration.findUnique({ where: { id: input.integrationId }, include: { provider: true } });
    if (!integration) throw Errors.notFound('INTEGRATION_NOT_FOUND', 'Integracion no encontrada');

    const failNoTx = (engineCode: EngineCode, message: string): EngineResult<OperationResults[O]> => ({
      ok: false, error: { ...adapterError('UNAVAILABLE', message), engineCode }, transactionId: null, attempts: 0, latencyMs: Date.now() - started,
    });
    if (!isHealth && (!integration.enabled || !integration.provider.active)) {
      return failNoTx('INTEGRATION_DISABLED', integration.provider.active ? 'La integracion esta deshabilitada' : 'El proveedor esta inactivo');
    }

    if (write) {
      const previous = await this.previousExecution(input.operationKey!);
      if (previous) return this.fromPrevious<O>(previous, started);
    }

    const cfgResult = await this.runtimeConfig(integration);
    const outboundKey = write ? `mgt-${createHash('sha256').update(input.operationKey!).digest('hex').slice(0, 40)}` : undefined;

    let handle: TransactionHandle;
    try {
      handle = await this.transactions.start({
        operation: op, integrationId: integration.id, providerId: integration.providerId, operationKey: input.operationKey,
        idempotencyKey: outboundKey, bookingItemId: input.bookingItemId, requestPayload: input.request,
      });
    } catch (e) {
      if (write && isUniqueViolation(e)) {
        // Otra ejecucion concurrente con la misma clave gano la carrera.
        const previous = await this.previousExecution(input.operationKey!);
        if (previous) return this.fromPrevious<O>(previous, started);
      }
      throw e;
    }

    if (!cfgResult.ok) {
      const error: EngineError = { ...adapterError('UNAVAILABLE', cfgResult.message), engineCode: 'NOT_CONFIGURED' };
      await this.transactions.finish(handle, { status: 'FAILED', attempts: 0, errorCode: 'NOT_CONFIGURED', errorMessage: error.message, responsePayload: { ok: false, error }, releaseOperationKey: true });
      return { ok: false, error, transactionId: handle.id, attempts: 0, latencyMs: Date.now() - started };
    }
    const cfg = cfgResult.cfg;
    const bcfg: BreakerConfig = { ...cfg.circuitBreaker, trialLeaseMs: maxExecutionMs(cfg) };
    const bctx = { integrationId: integration.id, providerId: integration.providerId, integrationName: integration.name };

    // El health-check es una sonda del operador: no lo corta el circuito ni lo modifica.
    let trial = false;
    if (!isHealth) {
      const decision = await this.breaker.acquire(integration.id, bcfg);
      if (!decision.allowed) {
        const retryAt = decision.retryAt?.toISOString();
        const error: EngineError = {
          ...adapterError('UNAVAILABLE', `Circuito abierto: no se llama al proveedor${retryAt ? ` hasta ${retryAt}` : ''}`, { retryable: true }),
          engineCode: 'CIRCUIT_OPEN', ...(retryAt && { retryAt }),
        };
        await this.transactions.finish(handle, {
          status: 'SHORT_CIRCUITED', attempts: 0, errorCode: 'CIRCUIT_OPEN', errorMessage: error.message, responsePayload: { ok: false, error }, releaseOperationKey: true,
        });
        return { ok: false, error, transactionId: handle.id, attempts: 0, latencyMs: Date.now() - started };
      }
      trial = decision.trial;
    }

    const adapter = this.registry.get(integration.adapterKind);
    let attempts = 0;
    let last: AdapterResult<OperationResults[O]> | undefined;
    try {
      for (;;) {
        attempts++;
        const t0 = Date.now();
        const ctx: AdapterCallContext = {
          correlationId: handle.correlationId, transactionId: handle.id, attempt: attempts, provider: cfg,
          ...(outboundKey && cfg.supportsIdempotency && { idempotencyKey: outboundKey }),
        };
        last = await this.invoke(adapter, op, input.request, ctx, cfg.timeoutMs, write);
        const durationMs = Date.now() - t0;
        if (last.ok) {
          await this.transactions.recordAttempt(handle, { attemptNumber: attempts, status: 'SUCCESS', durationMs });
          break;
        }
        const retry = shouldRetry(op, last.error, attempts, cfg);
        const backoffMs = retry ? backoffDelay(attempts, cfg.retryBaseMs, cfg.retryMaxMs) : undefined;
        await this.transactions.recordAttempt(handle, {
          attemptNumber: attempts, status: txStatusOf(last.error), durationMs, backoffMs, errorCode: last.error.code, errorMessage: last.error.message,
        });
        if (!retry) break;
        await sleep(backoffMs!);
      }
    } catch (e) {
      // Falla interna (no del proveedor): se cierra la transaccion y se libera la prueba del circuito.
      await this.transactions.finish(handle, { status: 'FAILED', attempts, errorCode: 'ENGINE_ERROR', errorMessage: (e as Error).message }).catch(() => undefined);
      if (trial) await this.breaker.release(integration.id).catch(() => undefined);
      throw e;
    }

    const latencyMs = Date.now() - started;
    const result = last!;
    if (result.ok) {
      await this.transactions.finish(handle, { status: 'SUCCESS', attempts, httpStatus: result.httpStatus, responsePayload: { ok: true, data: result.data } });
      if (!isHealth) await this.breaker.recordSuccess(bctx, bcfg);
      return { ok: true, data: result.data, httpStatus: result.httpStatus, transactionId: handle.id, attempts, latencyMs, replayed: false };
    }

    const error = publicError(result.error);
    await this.transactions.finish(handle, {
      status: txStatusOf(error), attempts, httpStatus: error.httpStatus, errorCode: error.code, errorMessage: error.message, responsePayload: { ok: false, error },
    });
    if (!isHealth) {
      // Un rechazo de negocio (sin cupo, precio) prueba que el proveedor esta sano.
      if (countsAsProviderFailure(error.code)) await this.breaker.recordFailure(bctx, bcfg, `${error.code}: ${error.message}`);
      else await this.breaker.recordSuccess(bctx, bcfg);
    }
    // Los health-checks fallidos ya quedan en su historial; aqui se registran las operaciones de negocio.
    if (!isHealth && (countsAsProviderFailure(error.code) || error.outcomeUnknown)) {
      await this.systemLog.write(error.outcomeUnknown ? 'ERROR' : 'WARN', 'integration-engine', `${op} fallo en ${integration.name}: ${error.code} - ${error.message}`, {
        integrationId: integration.id, transactionId: handle.id, operation: op, attempts, outcomeUnknown: error.outcomeUnknown,
      });
    }
    return { ok: false, error, transactionId: handle.id, attempts, latencyMs };
  }

  // ---------------- internos ----------------

  private async runtimeConfig(integration: IntegrationRow): Promise<{ ok: true; cfg: ProviderRuntimeConfig } | { ok: false; message: string }> {
    try {
      return { ok: true, cfg: await this.providers.getRuntimeConfig(integration.providerId) };
    } catch (e) {
      if (e instanceof AppException && e.code === 'PROVIDER_NOT_CONFIGURED') {
        if (integration.adapterKind !== 'HTTP') return { ok: true, cfg: defaultRuntimeConfig(integration.provider) };
        return { ok: false, message: 'El proveedor no tiene ficha tecnica de conexion' };
      }
      this.logger.error(`No se pudo cargar la configuracion del proveedor ${integration.providerId}: ${(e as Error).message}`);
      return { ok: false, message: 'No se pudo cargar o descifrar la configuracion del proveedor' };
    }
  }

  /** Llama al adaptador con timeout propio: aunque el adaptador ignore la senal, el motor no espera de mas. */
  private async invoke<O extends OperationName>(
    adapter: ProviderAdapter, op: O, request: OperationRequests[O], ctx: AdapterCallContext, timeoutMs: number, write: boolean,
  ): Promise<AdapterResult<OperationResults[O]>> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AdapterResult<never>>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, error: adapterError('TIMEOUT', `Sin respuesta del proveedor tras ${timeoutMs} ms`, { retryable: true, outcomeUnknown: write }) });
      }, timeoutMs);
    });
    const call = (async (): Promise<AdapterResult<OperationResults[O]>> => {
      const c = { ...ctx, signal: controller.signal };
      switch (op) {
        case 'HEALTH_CHECK': return (await adapter.healthCheck(c)) as AdapterResult<OperationResults[O]>;
        case 'SEARCH': return (await adapter.searchAvailability(request as AvailabilityQuery, c)) as AdapterResult<OperationResults[O]>;
        case 'GET_RATES': return (await adapter.getRates(request as RateQuery, c)) as AdapterResult<OperationResults[O]>;
        case 'HOLD': return (await adapter.hold(request as HoldRequest, c)) as AdapterResult<OperationResults[O]>;
        case 'CONFIRM': return (await adapter.confirm(request as ConfirmRequest, c)) as AdapterResult<OperationResults[O]>;
        case 'CANCEL': return (await adapter.cancel(request as CancelRequest, c)) as AdapterResult<OperationResults[O]>;
        case 'QUERY_BOOKING': return (await adapter.queryBooking(request as QueryBookingRequest, c)) as AdapterResult<OperationResults[O]>;
        default: throw new Error(`Operacion no soportada: ${String(op)}`);
      }
    })().catch((e: unknown): AdapterResult<OperationResults[O]> => {
      this.logger.error(`El adaptador ${adapter.kind} lanzo una excepcion en ${op}: ${(e as Error).message}`);
      return { ok: false, error: adapterError('UNKNOWN', 'Error inesperado en el adaptador', { outcomeUnknown: write }) };
    });
    try {
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private previousExecution(operationKey: string) {
    return this.prisma.integrationTransaction.findUnique({
      where: { operationKey },
      select: { id: true, status: true, attempts: true, startedAt: true, responsePayload: true, httpStatus: true, integrationId: true },
    });
  }

  /** Resultado de una ejecucion previa con la misma operationKey: nunca se vuelve a llamar al proveedor. */
  private async fromPrevious<O extends OperationName>(
    prev: NonNullable<Awaited<ReturnType<IntegrationEngine['previousExecution']>>>, started: number,
  ): Promise<EngineResult<OperationResults[O]>> {
    const latencyMs = Date.now() - started;
    const payload = (prev.responsePayload ?? null) as { ok?: boolean; data?: unknown; error?: EngineError } | null;
    if (prev.status === 'SUCCESS' && payload?.ok === true && payload.data !== undefined) {
      return { ok: true, data: payload.data as OperationResults[O], httpStatus: prev.httpStatus ?? undefined, transactionId: prev.id, attempts: prev.attempts, latencyMs, replayed: true };
    }
    if (prev.status === 'PENDING') {
      const cfg = prev.integrationId ? await this.prisma.integration.findUnique({ where: { id: prev.integrationId }, select: { providerId: true } }) : null;
      let limit = 10 * 60_000;
      if (cfg) {
        try {
          limit = maxExecutionMs(await this.providers.getRuntimeConfig(cfg.providerId)) + 60_000;
        } catch {
          // sin ficha tecnica: se usa el limite por defecto
        }
      }
      const stale = Date.now() - prev.startedAt.getTime() > limit;
      return {
        ok: false, transactionId: prev.id, attempts: prev.attempts, latencyMs,
        error: stale
          ? { ...adapterError('UNKNOWN', 'Una ejecucion anterior quedo sin terminar: consulte el estado en el proveedor', { outcomeUnknown: true }), engineCode: 'OPERATION_ALREADY_EXECUTED' }
          : { ...adapterError('UNKNOWN', 'La operacion ya esta en curso', { retryable: true, outcomeUnknown: true }), engineCode: 'OPERATION_IN_PROGRESS' },
      };
    }
    const stored = payload?.error;
    const base = stored && typeof stored.code === 'string'
      ? stored
      : adapterError('UNKNOWN', 'Una ejecucion anterior termino sin resultado legible', { outcomeUnknown: true });
    return { ok: false, transactionId: prev.id, attempts: prev.attempts, latencyMs, error: { ...base, engineCode: 'OPERATION_ALREADY_EXECUTED' } };
  }
}
