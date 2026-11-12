import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toJsonInput } from '../database/json';
import { Errors } from '../errors/app.exception';

export type Claim =
  | { kind: 'execute'; id: string }
  | { kind: 'replay'; status: number; body: unknown };

/** Respuesta de error guardada para repetirla tal cual. */
export interface StoredError {
  error: { status: number; code: string; message: string; details?: unknown };
}

export const isStoredError = (b: unknown): b is StoredError =>
  typeof b === 'object' && b !== null && 'error' in b && typeof (b as StoredError).error?.status === 'number';

/** Una ejecucion IN_PROGRESS sin terminar despues de este tiempo se considera abandonada (proceso caido). */
export const STALE_LOCK_MS = 120_000;

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Idempotencia de entrada sobre idempotency_keys (unico (idem_key, scope) + hash de la solicitud).
 * La reserva de la clave es atomica (INSERT con restriccion unica): dos peticiones simultaneas con la
 * misma clave nunca ejecutan dos veces; la segunda recibe 409 mientras la primera esta en curso.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(scope: string, key: string, requestHash: string, userId: string | null, ttlMs: number): Promise<Claim> {
    for (let round = 0; round < 3; round++) {
      const now = new Date();
      try {
        const row = await this.prisma.idempotencyKey.create({
          data: { idemKey: key, scope, requestHash, userId, status: 'IN_PROGRESS', lockedAt: now, expiresAt: new Date(now.getTime() + ttlMs) },
          select: { id: true },
        });
        return { kind: 'execute', id: row.id };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }

      const ex = await this.prisma.idempotencyKey.findUnique({ where: { idemKey_scope: { idemKey: key, scope } } });
      if (!ex) continue; // se borro entre medio (vencida): reintentar la reserva
      if (ex.expiresAt.getTime() <= now.getTime()) {
        await this.prisma.idempotencyKey.deleteMany({ where: { id: ex.id, expiresAt: ex.expiresAt } });
        continue;
      }
      if (ex.requestHash !== requestHash) {
        throw Errors.unprocessable('IDEMPOTENCY_KEY_REUSED', 'La clave de idempotencia ya se uso con una solicitud distinta');
      }
      if (ex.status === 'COMPLETED') return { kind: 'replay', status: ex.responseStatus ?? 200, body: ex.responseBody };

      // IN_PROGRESS abandonada o FAILED: se toma la clave de forma condicional (solo una peticion lo logra).
      const takeOver = ex.status === 'FAILED' || now.getTime() - ex.lockedAt.getTime() > STALE_LOCK_MS;
      if (takeOver) {
        const r = await this.prisma.idempotencyKey.updateMany({
          where: { id: ex.id, status: ex.status, lockedAt: ex.lockedAt },
          data: { status: 'IN_PROGRESS', lockedAt: now },
        });
        if (r.count === 1) return { kind: 'execute', id: ex.id };
        continue;
      }
      throw Errors.conflict('IDEMPOTENCY_IN_PROGRESS', 'Hay una solicitud con la misma clave de idempotencia en curso; reintente en unos segundos');
    }
    throw Errors.conflict('IDEMPOTENCY_IN_PROGRESS', 'No se pudo reservar la clave de idempotencia; reintente');
  }

  async complete(id: string, status: number, body: unknown): Promise<void> {
    // Se normaliza a JSON puro (Date -> ISO, Decimal -> string) para repetir exactamente lo que se envio.
    const json = body === undefined ? null : JSON.parse(JSON.stringify(body));
    await this.prisma.idempotencyKey.update({
      where: { id },
      data: { status: 'COMPLETED', responseStatus: status, responseBody: toJsonInput(json), completedAt: new Date() },
    });
  }

  /** La ejecucion fallo por un error no determinista (5xx, conflicto): la clave puede reutilizarse. */
  async fail(id: string): Promise<void> {
    await this.prisma.idempotencyKey.update({ where: { id }, data: { status: 'FAILED' } });
  }
}
