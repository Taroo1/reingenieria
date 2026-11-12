import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { addDaysIso, diffDaysIso, isIsoDate, todayIso, toIsoDate } from '../../common/time/dates';
import { AuditService } from '../audit/audit.service';
import { AdjustLevelDto, CreateAllotmentDto, LevelsQueryDto, ListAllotmentsQueryDto, MovementsQueryDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

const MAX_ALLOTMENT_DAYS = 366;
const ALLOTMENT_REF = 'allotment';
const ADJUST_REF = 'manual_adjust';

function datesBetween(from: string, to: string): string[] {
  return Array.from({ length: diffDaysIso(from, to) + 1 }, (_, i) => addDaysIso(from, i));
}

/** Carga y retiro de cupos contratados. Cada cambio de total queda en el libro de movimientos y en la auditoria. */
@Injectable()
export class AllotmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateAllotmentDto) {
    if (!isIsoDate(dto.validFrom) || !isIsoDate(dto.validTo)) throw Errors.badRequest('INVALID_DATE', 'Fechas calendario invalidas');
    if (dto.validTo < dto.validFrom) throw Errors.badRequest('INVALID_DATE_RANGE', 'validTo no puede ser anterior a validFrom');
    if (diffDaysIso(dto.validFrom, dto.validTo) + 1 > MAX_ALLOTMENT_DAYS) throw Errors.badRequest('ALLOTMENT_TOO_LONG', `Un allotment cubre como maximo ${MAX_ALLOTMENT_DAYS} dias`);
    if (dto.validTo < todayIso()) throw Errors.badRequest('ALLOTMENT_IN_PAST', 'El allotment termina en el pasado');
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw Errors.notFound('PRODUCT_NOT_FOUND', 'Producto no encontrado');
    if (product.status !== 'ACTIVE') throw Errors.conflict('PRODUCT_INACTIVE', 'El producto esta inactivo');
    if (product.type === 'ASSISTANCE_PLAN') throw Errors.badRequest('ALLOTMENT_NOT_APPLICABLE', 'Los planes de asistencia no tienen cupo');

    const userId = getRequestContext()?.userId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.allotment.create({
        data: {
          productId: dto.productId, validFrom: new Date(`${dto.validFrom}T00:00:00Z`), validTo: new Date(`${dto.validTo}T00:00:00Z`),
          quantity: dto.quantity, releaseDays: dto.releaseDays ?? 0, notes: dto.notes ?? null, createdById: userId,
        },
      });
      for (const date of datesBetween(dto.validFrom, dto.validTo)) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO inventory_levels (id, product_id, stay_date, total_quantity, updated_at)
          VALUES (gen_random_uuid(), ${dto.productId}::uuid, ${date}::date, ${dto.quantity}, now())
          ON CONFLICT (product_id, stay_date)
          DO UPDATE SET total_quantity = inventory_levels.total_quantity + EXCLUDED.total_quantity,
                        version = inventory_levels.version + 1, updated_at = now()
          RETURNING id`;
        await this.inventory.movement(tx, rows[0].id, 'LOAD', { deltaTotal: dto.quantity }, a.id, userId, ALLOTMENT_REF);
      }
      await this.audit.record({ action: 'ALLOTMENT_CREATED', entity: 'allotment', entityId: a.id, after: a }, tx);
      return a;
    }, { timeout: 30_000 });
  }

  /**
   * Retira un allotment: descuenta su cantidad de las fechas futuras. Si alguna fecha ya tiene vendido o
   * bloqueado mas de lo que quedaria, no se aplica nada (409 ALLOTMENT_IN_USE).
   */
  async deactivate(id: string) {
    const a = await this.prisma.allotment.findUnique({ where: { id } });
    if (!a) throw Errors.notFound('ALLOTMENT_NOT_FOUND', 'Allotment no encontrado');
    if (!a.active) return a;
    const userId = getRequestContext()?.userId ?? null;
    const from = [toIsoDate(a.validFrom), todayIso()].sort()[1];
    const to = toIsoDate(a.validTo);
    return this.prisma.$transaction(async (tx) => {
      if (from <= to) {
        for (const date of datesBetween(from, to)) {
          const rows = await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE inventory_levels SET total_quantity = total_quantity - ${a.quantity}, version = version + 1, updated_at = now()
             WHERE product_id = ${a.productId}::uuid AND stay_date = ${date}::date
               AND total_quantity - ${a.quantity} >= held_quantity + sold_quantity
            RETURNING id`;
          if (rows.length === 0) {
            throw Errors.conflict('ALLOTMENT_IN_USE', `No se puede retirar el cupo: el ${date} ya hay unidades bloqueadas o vendidas`, { date });
          }
          await this.inventory.movement(tx, rows[0].id, 'ADJUST', { deltaTotal: -a.quantity }, a.id, userId, ALLOTMENT_REF);
        }
      }
      const updated = await tx.allotment.update({ where: { id }, data: { active: false } });
      await this.audit.record({ action: 'ALLOTMENT_DEACTIVATED', entity: 'allotment', entityId: id, before: a, after: updated }, tx);
      return updated;
    }, { timeout: 30_000 });
  }

  /** Ajuste manual del total de una fecha (correccion, sobreventa pactada con el hotel...). */
  async adjust(dto: AdjustLevelDto) {
    if (!isIsoDate(dto.date)) throw Errors.badRequest('INVALID_DATE', 'Fecha calendario invalida');
    const userId = getRequestContext()?.userId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; total_quantity: number; held_quantity: number; sold_quantity: number }>>`
        UPDATE inventory_levels SET total_quantity = total_quantity + ${dto.delta}, version = version + 1, updated_at = now()
         WHERE product_id = ${dto.productId}::uuid AND stay_date = ${dto.date}::date
           AND total_quantity + ${dto.delta} >= held_quantity + sold_quantity
        RETURNING id, total_quantity, held_quantity, sold_quantity`;
      if (rows.length === 0) {
        const exists = await tx.inventoryLevel.findUnique({ where: { productId_stayDate: { productId: dto.productId, stayDate: new Date(`${dto.date}T00:00:00Z`) } } });
        if (!exists) throw Errors.notFound('LEVEL_NOT_FOUND', 'No hay cupo cargado para esa fecha');
        throw Errors.conflict('ADJUST_BELOW_COMMITTED', 'El total no puede quedar por debajo de lo bloqueado y vendido');
      }
      const r = rows[0];
      await this.inventory.movement(tx, r.id, 'ADJUST', { deltaTotal: dto.delta }, null, userId, ADJUST_REF);
      await this.audit.record({ action: 'INVENTORY_ADJUSTED', entity: 'inventory_level', entityId: r.id, after: { delta: dto.delta, reason: dto.reason, total: r.total_quantity } }, tx);
      return { levelId: r.id, date: dto.date, totalQuantity: r.total_quantity, heldQuantity: r.held_quantity, soldQuantity: r.sold_quantity, available: r.total_quantity - r.held_quantity - r.sold_quantity };
    });
  }

  async list(q: ListAllotmentsQueryDto) {
    const where: Prisma.AllotmentWhereInput = { ...(q.productId && { productId: q.productId }), ...(q.active !== undefined && { active: q.active }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.allotment.findMany({ where, include: { product: { select: { id: true, code: true, name: true } } }, orderBy: { validFrom: 'asc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.allotment.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }

  async levels(q: LevelsQueryDto) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.to < q.from) throw Errors.badRequest('INVALID_DATE_RANGE', 'Rango de fechas invalido');
    if (diffDaysIso(q.from, q.to) > MAX_ALLOTMENT_DAYS) throw Errors.badRequest('RANGE_TOO_LONG', 'Rango maximo de 366 dias');
    const rows = await this.prisma.inventoryLevel.findMany({
      where: { productId: q.productId, stayDate: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) } },
      orderBy: { stayDate: 'asc' },
    });
    return rows.map((l) => ({
      id: l.id, date: toIsoDate(l.stayDate), totalQuantity: l.totalQuantity, heldQuantity: l.heldQuantity, soldQuantity: l.soldQuantity,
      available: l.totalQuantity - l.heldQuantity - l.soldQuantity, version: l.version,
    }));
  }

  async movements(levelId: string, q: MovementsQueryDto) {
    const where = { levelId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({ where, orderBy: { at: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return new PageResult(rows, total, q.page, q.pageSize);
  }
}
