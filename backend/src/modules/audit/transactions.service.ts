import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { IntegrationOperation, Prisma, TransactionStatus } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { toJsonInput } from '../../common/database/json';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { toStorablePayload } from '../../common/security/redact';
import { TransactionQueryDto } from './dto/audit-query.dto';

export interface StartTransactionInput {
  operation: IntegrationOperation;
  integrationId?: string;
  providerId?: string;
  /** Clave de negocio unica de una operacion de escritura (item + tipo): impide duplicados a nivel de base. */
  operationKey?: string;
  idempotencyKey?: string;
  bookingItemId?: string;
  requestPayload?: unknown;
}

export interface TransactionHandle {
  /** Es el identificador de transaccion (transactionId) que se devuelve en las respuestas. */
  id: string;
  correlationId: string;
  startedAtMs: number;
}

export interface FinishTransactionInput {
  status: TransactionStatus;
  attempts?: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  responsePayload?: unknown;
  /** Libera la clave de operacion (la llamada nunca llego al proveedor y puede repetirse con la misma clave). */
  releaseOperationKey?: boolean;
}

export interface AttemptInput {
  attemptNumber: number;
  status: TransactionStatus;
  durationMs?: number;
  backoffMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

/** Registro de cada llamada a un proveedor: quien, que, cuando, cuanto tardo, como termino y cuantos intentos hubo. */
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: StartTransactionInput, tx?: PrismaTx): Promise<TransactionHandle> {
    const ctx = getRequestContext();
    const db = tx ?? this.prisma;
    const correlationId = ctx?.correlationId ?? randomUUID();
    const row = await db.integrationTransaction.create({
      data: {
        correlationId,
        operation: input.operation,
        integrationId: input.integrationId ?? null,
        providerId: input.providerId ?? null,
        operationKey: input.operationKey ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        bookingItemId: input.bookingItemId ?? null,
        userId: ctx?.userId ?? null,
        status: TransactionStatus.PENDING,
        requestPayload: toJsonInput(toStorablePayload(input.requestPayload)),
      },
      select: { id: true, startedAt: true },
    });
    return { id: row.id, correlationId, startedAtMs: row.startedAt.getTime() };
  }

  async recordAttempt(handle: TransactionHandle, a: AttemptInput, tx?: PrismaTx): Promise<void> {
    const db = tx ?? this.prisma;
    await db.transactionAttempt.create({
      data: {
        transactionId: handle.id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        durationMs: a.durationMs ?? null,
        backoffMs: a.backoffMs ?? null,
        errorCode: a.errorCode ?? null,
        errorMessage: a.errorMessage?.slice(0, 1000) ?? null,
      },
    });
  }

  async finish(handle: TransactionHandle, r: FinishTransactionInput, tx?: PrismaTx): Promise<void> {
    const db = tx ?? this.prisma;
    const now = Date.now();
    await db.integrationTransaction.update({
      where: { id: handle.id },
      data: {
        status: r.status,
        finishedAt: new Date(now),
        durationMs: Math.max(0, now - handle.startedAtMs),
        ...(r.attempts !== undefined && { attempts: r.attempts }),
        httpStatus: r.httpStatus ?? null,
        errorCode: r.errorCode ?? null,
        errorMessage: r.errorMessage?.slice(0, 1000) ?? null,
        responsePayload: toJsonInput(toStorablePayload(r.responsePayload)),
        ...(r.releaseOperationKey && { operationKey: null }),
      },
    });
  }

  async list(q: TransactionQueryDto): Promise<PageResult<unknown>> {
    const where: Prisma.IntegrationTransactionWhereInput = {
      ...(q.providerId && { providerId: q.providerId }),
      ...(q.integrationId && { integrationId: q.integrationId }),
      ...(q.status && { status: q.status }),
      ...(q.operation && { operation: q.operation }),
      ...(q.correlationId && { correlationId: q.correlationId }),
      ...((q.from || q.to) && {
        startedAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) },
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.integrationTransaction.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          provider: { select: { id: true, code: true, name: true } },
          integration: { select: { id: true, name: true, adapterKind: true } },
          user: { select: { id: true, email: true } },
        },
      }),
      this.prisma.integrationTransaction.count({ where }),
    ]);
    return new PageResult(items, total, q.page, q.pageSize);
  }

  async get(id: string): Promise<unknown> {
    const row = await this.prisma.integrationTransaction.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, code: true, name: true } },
        integration: { select: { id: true, name: true, adapterKind: true } },
        user: { select: { id: true, email: true } },
        transactionAttemptsByTransactionId: { orderBy: { attemptNumber: 'asc' } },
      },
    });
    if (!row) throw Errors.notFound('TRANSACTION_NOT_FOUND', 'Transaccion no encontrada');
    const { transactionAttemptsByTransactionId, ...rest } = row;
    return { ...rest, attempts: transactionAttemptsByTransactionId };
  }
}
