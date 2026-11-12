import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { toJsonInput } from '../../common/database/json';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { redactSecrets } from '../../common/security/redact';
import { AuditLogQueryDto } from './dto/audit-query.dto';

export interface AuditInput {
  /** Verbo en mayusculas, p. ej. PROVIDER_CREATED. */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Si se omite se toma el usuario de la peticion en curso. */
  userId?: string | null;
}

/** Auditoria de acciones de usuario. La tabla es de solo insercion (trigger en la base). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra la accion. Pasar `tx` para escribirla en la misma transaccion que el cambio auditado:
   * si el cambio se revierte, la auditoria tambien; si la auditoria falla, el cambio no se aplica.
   */
  async record(input: AuditInput, tx?: PrismaTx): Promise<void> {
    const ctx = getRequestContext();
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        userId: input.userId !== undefined ? input.userId : (ctx?.userId ?? null),
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: toJsonInput(redactSecrets(input.before)),
        after: toJsonInput(redactSecrets(input.after)),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        correlationId: ctx?.correlationId ?? null,
      },
    });
  }

  async list(q: AuditLogQueryDto): Promise<PageResult<unknown>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.userId && { userId: q.userId }),
      ...(q.entity && { entity: q.entity }),
      ...(q.entityId && { entityId: q.entityId }),
      ...(q.action && { action: q.action }),
      ...(q.correlationId && { correlationId: q.correlationId }),
      ...((q.from || q.to) && {
        at: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) },
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: { user: { select: { id: true, email: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new PageResult(items, total, q.page, q.pageSize);
  }
}
