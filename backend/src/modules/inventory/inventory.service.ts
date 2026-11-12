import { Injectable } from '@nestjs/common';
import { MovementKind } from '@prisma/client';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { diffDaysIso, todayIso } from '../../common/time/dates';

export class NoAllotmentAvailabilityError extends Error {
  constructor(readonly productId: string, readonly date: string) {
    super(`Sin cupo disponible el ${date}`);
  }
}

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const BOOKING_ITEM_REF = 'booking_item';

/**
 * Operaciones atomicas sobre el cupo propio (ALLOTMENT). La base es la fuente de verdad:
 *  - bloquear: UPDATE condicional "total - held - sold >= n" por fecha (nunca leer-y-luego-escribir);
 *    si una fecha no alcanza, la transaccion completa se revierte. El CHECK held + sold <= total de la
 *    base es la segunda linea de defensa.
 *  - cada cambio deja un movimiento en inventory_movements (libro de solo insercion).
 * Todas las operaciones reciben la transaccion del llamador, para quedar en la misma unidad que la reserva.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bloquea quantity unidades en cada fecha (orden de fechas fijo: evita interbloqueos entre transacciones). */
  async hold(tx: PrismaTx, input: { productId: string; dates: string[]; quantity: number; bookingItemId: string; expiresAt: Date; userId?: string | null }): Promise<void> {
    const blocked = await this.releaseBlockedDates(tx, input.productId, input.dates);
    if (blocked) throw new NoAllotmentAvailabilityError(input.productId, blocked);
    for (const date of [...input.dates].sort()) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE inventory_levels
           SET held_quantity = held_quantity + ${input.quantity}, version = version + 1, updated_at = now()
         WHERE product_id = ${input.productId}::uuid AND stay_date = ${date}::date
           AND total_quantity - held_quantity - sold_quantity >= ${input.quantity}
        RETURNING id`;
      if (rows.length === 0) throw new NoAllotmentAvailabilityError(input.productId, date);
      const levelId = rows[0].id;
      await tx.inventoryHold.create({ data: { levelId, bookingItemId: input.bookingItemId, quantity: input.quantity, expiresAt: input.expiresAt } });
      await this.movement(tx, levelId, 'HOLD', { deltaHeld: input.quantity }, input.bookingItemId, input.userId);
    }
  }

  /** Libera los bloqueos activos del item (cancelacion previa a confirmar o vencimiento). Idempotente. */
  async release(tx: PrismaTx, bookingItemId: string, kind: 'RELEASE' | 'EXPIRE', userId?: string | null): Promise<number> {
    const holds = await tx.inventoryHold.findMany({ where: { bookingItemId, status: 'ACTIVE' }, orderBy: { levelId: 'asc' } });
    let released = 0;
    for (const h of holds) {
      const claimed = await tx.inventoryHold.updateMany({
        where: { id: h.id, status: 'ACTIVE' },
        data: { status: kind === 'EXPIRE' ? 'EXPIRED' : 'RELEASED', releasedAt: new Date() },
      });
      if (claimed.count === 0) continue; // otro proceso ya lo libero
      await tx.$executeRaw`
        UPDATE inventory_levels SET held_quantity = held_quantity - ${h.quantity}, version = version + 1, updated_at = now()
         WHERE id = ${h.levelId}::uuid`;
      await this.movement(tx, h.levelId, kind, { deltaHeld: -h.quantity }, bookingItemId, userId);
      released++;
    }
    return released;
  }

  /** Convierte los bloqueos del item en venta (held -> sold) al confirmarse la reserva. Idempotente. */
  async consume(tx: PrismaTx, bookingItemId: string, userId?: string | null): Promise<number> {
    const holds = await tx.inventoryHold.findMany({ where: { bookingItemId, status: 'ACTIVE' }, orderBy: { levelId: 'asc' } });
    for (const h of holds) {
      const claimed = await tx.inventoryHold.updateMany({ where: { id: h.id, status: 'ACTIVE' }, data: { status: 'CONSUMED' } });
      if (claimed.count === 0) continue;
      await tx.$executeRaw`
        UPDATE inventory_levels
           SET held_quantity = held_quantity - ${h.quantity}, sold_quantity = sold_quantity + ${h.quantity}, version = version + 1, updated_at = now()
         WHERE id = ${h.levelId}::uuid`;
      await this.movement(tx, h.levelId, 'CONFIRM', { deltaHeld: -h.quantity, deltaSold: h.quantity }, bookingItemId, userId);
    }
    return holds.length;
  }

  /** Devuelve al cupo lo vendido por un item cancelado. Idempotente (no devuelve dos veces la misma fecha). */
  async returnSold(tx: PrismaTx, bookingItemId: string, userId?: string | null): Promise<number> {
    const holds = await tx.inventoryHold.findMany({ where: { bookingItemId, status: 'CONSUMED' }, orderBy: { levelId: 'asc' } });
    let returned = 0;
    for (const h of holds) {
      const already = await tx.inventoryMovement.count({ where: { levelId: h.levelId, kind: 'CANCEL', referenceType: BOOKING_ITEM_REF, referenceId: bookingItemId } });
      if (already > 0) continue;
      await tx.$executeRaw`
        UPDATE inventory_levels SET sold_quantity = sold_quantity - ${h.quantity}, version = version + 1, updated_at = now()
         WHERE id = ${h.levelId}::uuid`;
      await this.movement(tx, h.levelId, 'CANCEL', { deltaSold: -h.quantity }, bookingItemId, userId);
      returned++;
    }
    return returned;
  }

  /** Cupo vendible (minimo entre las fechas). Fecha sin nivel o dentro del plazo de release = 0. */
  async available(productId: string, dates: string[], db: PrismaTx | PrismaService = this.prisma): Promise<number> {
    if (dates.length === 0) return 0;
    if (await this.releaseBlockedDates(db, productId, dates)) return 0;
    const levels = await db.inventoryLevel.findMany({ where: { productId, stayDate: { in: dates.map(asDate) } } });
    if (levels.length < new Set(dates).size) return 0;
    return Math.max(0, Math.min(...levels.map((l) => l.totalQuantity - l.heldQuantity - l.soldQuantity)));
  }

  /**
   * Unidades fisicas restantes de una fecha (total - bloqueado - vendido), sin aplicar el plazo de release.
   * Es lo comparable con lo que informa el hotel; null si no hay cupo cargado.
   */
  async remaining(productId: string, date: string, db: PrismaTx | PrismaService = this.prisma): Promise<number | null> {
    const l = await db.inventoryLevel.findUnique({ where: { productId_stayDate: { productId, stayDate: asDate(date) } } });
    return l ? l.totalQuantity - l.heldQuantity - l.soldQuantity : null;
  }

  /**
   * Plazo de release: el cupo contratado vuelve al hotel releaseDays antes de la fecha; dentro de ese plazo
   * no se vende. Devuelve la primera fecha bloqueada o null.
   */
  async releaseBlockedDates(db: PrismaTx | PrismaService, productId: string, dates: string[]): Promise<string | null> {
    const allotments = await db.allotment.findMany({ where: { productId, active: true, releaseDays: { gt: 0 } } });
    if (allotments.length === 0) return null;
    const today = todayIso();
    for (const d of [...dates].sort()) {
      const covering = allotments.filter((a) => a.validFrom <= asDate(d) && a.validTo >= asDate(d));
      if (covering.length > 0 && covering.every((a) => diffDaysIso(today, d) < a.releaseDays)) return d;
    }
    return null;
  }

  async movement(
    tx: PrismaTx, levelId: string, kind: MovementKind, d: { deltaTotal?: number; deltaHeld?: number; deltaSold?: number },
    referenceId: string | null, userId?: string | null, referenceType = BOOKING_ITEM_REF,
  ): Promise<void> {
    await tx.inventoryMovement.create({
      data: {
        levelId, kind, deltaTotal: d.deltaTotal ?? 0, deltaHeld: d.deltaHeld ?? 0, deltaSold: d.deltaSold ?? 0,
        referenceType: referenceId ? referenceType : null, referenceId, userId: userId ?? null,
      },
    });
  }
}
