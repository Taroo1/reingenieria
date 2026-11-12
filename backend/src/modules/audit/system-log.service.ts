import { Injectable, Logger } from '@nestjs/common';
import { LogLevel, Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getCorrelationId } from '../../common/context/request-context';
import { toJsonInput } from '../../common/database/json';
import { PrismaService } from '../../common/database/prisma.service';
import { toStorablePayload } from '../../common/security/redact';
import { SystemLogQueryDto } from './dto/audit-query.dto';

/** Eventos del sistema relevantes para operacion (no reemplaza al logger de la aplicacion). */
@Injectable()
export class SystemLogService {
  private readonly logger = new Logger(SystemLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mejor esfuerzo: un fallo al registrar nunca debe romper la operacion de negocio. */
  async write(level: LogLevel, context: string, message: string, meta?: unknown): Promise<void> {
    try {
      await this.prisma.systemLog.create({
        data: {
          level,
          context,
          message: message.slice(0, 2000),
          correlationId: getCorrelationId() ?? null,
          meta: toJsonInput(toStorablePayload(meta)),
        },
      });
    } catch (err) {
      this.logger.warn(`No se pudo registrar el log de sistema: ${(err as Error).message}`);
    }
  }

  async list(q: SystemLogQueryDto): Promise<PageResult<unknown>> {
    const where: Prisma.SystemLogWhereInput = {
      ...(q.level && { level: q.level }),
      ...(q.context && { context: q.context }),
      ...(q.correlationId && { correlationId: q.correlationId }),
      ...((q.from || q.to) && {
        at: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) },
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.systemLog.findMany({ where, orderBy: { at: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.systemLog.count({ where }),
    ]);
    return new PageResult(items, total, q.page, q.pageSize);
  }
}
