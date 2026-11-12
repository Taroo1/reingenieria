import { Injectable } from '@nestjs/common';
import { AlertKind, Severity } from '@prisma/client';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';

export interface RaiseAlertInput {
  kind: AlertKind;
  severity: Severity;
  message: string;
  /** Una alerta abierta (o reconocida) con la misma clave no se duplica. */
  dedupeKey: string;
  integrationId?: string | null;
  providerId?: string | null;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea la alerta si no hay otra activa con la misma clave. Llamar dentro de una transaccion que ya
   * serialice el evento (p. ej. con el bloqueo de fila del circuit breaker) para que no haya duplicados.
   */
  async raise(input: RaiseAlertInput, tx?: PrismaTx): Promise<{ id: string; created: boolean }> {
    const db = tx ?? this.prisma;
    const active = await db.alert.findFirst({
      where: { dedupeKey: input.dedupeKey, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: { id: true },
    });
    if (active) return { id: active.id, created: false };
    const row = await db.alert.create({
      data: {
        kind: input.kind,
        severity: input.severity,
        message: input.message.slice(0, 1000),
        dedupeKey: input.dedupeKey,
        integrationId: input.integrationId ?? null,
        providerId: input.providerId ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  }

  /** Resuelve automaticamente las alertas activas con esa clave (p. ej. el circuito volvio a cerrar). */
  async resolveByKey(dedupeKey: string, tx?: PrismaTx): Promise<number> {
    const db = tx ?? this.prisma;
    const r = await db.alert.updateMany({
      where: { dedupeKey, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return r.count;
  }
}

export const circuitAlertKey = (integrationId: string) => `CIRCUIT_OPEN:${integrationId}`;
