import { Injectable } from '@nestjs/common';
import { ExceptionType, Prisma, Severity } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../integration-engine/alerts.service';
import { AssignExceptionDto, CloseExceptionDto, ExceptionNoteDto, ListExceptionsQueryDto } from './dto/exceptions.dto';

export interface OpenExceptionInput {
  type: ExceptionType;
  severity: Severity;
  title: string;
  description?: string;
  bookingId?: string | null;
  transactionId?: string | null;
  providerId?: string | null;
}

const ACTIVE = ['OPEN', 'IN_PROGRESS'] as const;

/**
 * Casos que requieren intervencion humana (resultado desconocido, confirmacion parcial, cancelacion fallida,
 * diferencias con el proveedor...). Un caso activo del mismo tipo para la misma reserva y transaccion no se
 * duplica: se le agrega un evento. Los casos HIGH/CRITICAL generan alerta.
 */
@Injectable()
export class ExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async open(input: OpenExceptionInput, tx?: PrismaTx): Promise<{ id: string; created: boolean }> {
    const db = tx ?? this.prisma;
    const existing = await db.exceptionCase.findFirst({
      where: {
        type: input.type, status: { in: [...ACTIVE] }, bookingId: input.bookingId ?? null,
        ...(input.transactionId && { transactionId: input.transactionId }), ...(!input.bookingId && input.providerId && { providerId: input.providerId }),
      },
      select: { id: true },
    });
    if (existing) {
      await db.exceptionEvent.create({ data: { exceptionId: existing.id, kind: 'RECURRED', message: input.description ?? input.title, userId: getRequestContext()?.userId ?? null } });
      return { id: existing.id, created: false };
    }
    const row = await db.exceptionCase.create({
      data: {
        type: input.type, severity: input.severity, title: input.title.slice(0, 300), description: input.description?.slice(0, 4000) ?? null,
        bookingId: input.bookingId ?? null, transactionId: input.transactionId ?? null, providerId: input.providerId ?? null,
      },
      select: { id: true },
    });
    await db.exceptionEvent.create({ data: { exceptionId: row.id, kind: 'OPENED', message: input.description ?? input.title } });
    if (input.severity === 'HIGH' || input.severity === 'CRITICAL') {
      await this.alerts.raise({ kind: 'EXCEPTION_OPENED', severity: input.severity, message: input.title, dedupeKey: `EXCEPTION:${row.id}`, providerId: input.providerId ?? null }, tx);
    }
    return { id: row.id, created: true };
  }

  async list(q: ListExceptionsQueryDto) {
    const where: Prisma.ExceptionCaseWhereInput = {
      ...(q.status && { status: q.status }), ...(q.severity && { severity: q.severity }), ...(q.type && { type: q.type }),
      ...(q.bookingId && { bookingId: q.bookingId }), ...(q.providerId && { providerId: q.providerId }), ...(q.assignedToId && { assignedToId: q.assignedToId }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exceptionCase.findMany({
        where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: q.skip, take: q.pageSize,
        include: { booking: { select: { id: true, reference: true, status: true } }, provider: { select: { id: true, code: true } }, assignedTo: { select: { id: true, email: true } } },
      }),
      this.prisma.exceptionCase.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }

  async get(id: string) {
    const row = await this.prisma.exceptionCase.findUnique({
      where: { id },
      include: {
        booking: { select: { id: true, reference: true, status: true } }, provider: { select: { id: true, code: true, name: true } },
        assignedTo: { select: { id: true, email: true } }, resolvedBy: { select: { id: true, email: true } },
        exceptionEventsByExceptionId: { orderBy: { at: 'asc' }, include: { user: { select: { id: true, email: true } } } },
      },
    });
    if (!row) throw Errors.notFound('EXCEPTION_NOT_FOUND', 'Caso no encontrado');
    const { exceptionEventsByExceptionId, ...rest } = row;
    return { ...rest, events: exceptionEventsByExceptionId };
  }

  private async requireActive(id: string) {
    const row = await this.prisma.exceptionCase.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('EXCEPTION_NOT_FOUND', 'Caso no encontrado');
    if (!ACTIVE.includes(row.status as (typeof ACTIVE)[number])) throw Errors.conflict('EXCEPTION_CLOSED', 'El caso ya esta cerrado');
    return row;
  }

  async assign(id: string, dto: AssignExceptionDto) {
    const current = await this.requireActive(id);
    if (dto.assignedToId) {
      const u = await this.prisma.user.findUnique({ where: { id: dto.assignedToId }, include: { role: true } });
      if (!u?.active || u.role.name === 'CONSULTA') throw Errors.badRequest('INVALID_ASSIGNEE', 'Solo se asigna a un ADMIN u OPERADOR activo');
    }
    const userId = getRequestContext()?.userId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.exceptionCase.update({
        where: { id }, data: { assignedToId: dto.assignedToId, status: dto.assignedToId ? 'IN_PROGRESS' : 'OPEN' },
      });
      await tx.exceptionEvent.create({ data: { exceptionId: id, kind: 'ASSIGNED', message: dto.assignedToId ? `Asignado a ${dto.assignedToId}` : 'Desasignado', userId } });
      await this.audit.record({ action: 'EXCEPTION_ASSIGNED', entity: 'exception', entityId: id, before: { assignedToId: current.assignedToId }, after: { assignedToId: dto.assignedToId } }, tx);
      return updated;
    });
  }

  async note(id: string, dto: ExceptionNoteDto) {
    await this.requireActive(id);
    return this.prisma.exceptionEvent.create({ data: { exceptionId: id, kind: 'NOTE', message: dto.message, userId: getRequestContext()?.userId ?? null } });
  }

  async close(id: string, dto: CloseExceptionDto, outcome: 'RESOLVED' | 'DISMISSED') {
    await this.requireActive(id);
    const userId = getRequestContext()?.userId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.exceptionCase.update({ where: { id }, data: { status: outcome, resolution: dto.resolution, resolvedAt: new Date(), resolvedById: userId } });
      await tx.exceptionEvent.create({ data: { exceptionId: id, kind: outcome, message: dto.resolution, userId } });
      await this.alerts.resolveByKey(`EXCEPTION:${id}`, tx);
      await this.audit.record({ action: outcome === 'RESOLVED' ? 'EXCEPTION_RESOLVED' : 'EXCEPTION_DISMISSED', entity: 'exception', entityId: id, after: { resolution: dto.resolution } }, tx);
      return updated;
    });
  }
}
