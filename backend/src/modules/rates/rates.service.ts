import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { isIsoDate, toIsoDate } from '../../common/time/dates';
import { AuditService } from '../audit/audit.service';
import { CreateRateDto, ListRatesQueryDto, UpdateRateDto } from './dto/rates.dto';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

type RateRow = Prisma.RateGetPayload<object>;

export function rateView(r: RateRow) {
  return {
    id: r.id, productId: r.productId, rateCode: r.rateCode, currency: r.currency, amount: r.amount.toFixed(2), taxesAmount: r.taxesAmount.toFixed(2),
    validFrom: toIsoDate(r.validFrom), validTo: toIsoDate(r.validTo), providerRateRef: r.providerRateRef, active: r.active, updatedAt: r.updatedAt,
  };
}

/** Tarifas propias (allotment) y tarifas sincronizadas de proveedores. Todo cambio de importe queda en rate_history. */
@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tarifa activa que cubre el periodo completo; si hay varias, la mas reciente. */
  findApplicable(productId: string, firstDate: string, lastDate: string, rateCode?: string, db: PrismaTx | PrismaService = this.prisma) {
    return db.rate.findFirst({
      where: { productId, active: true, validFrom: { lte: asDate(firstDate) }, validTo: { gte: asDate(lastDate) }, ...(rateCode && { rateCode }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateRateDto) {
    if (!isIsoDate(dto.validFrom) || !isIsoDate(dto.validTo) || dto.validTo < dto.validFrom) throw Errors.badRequest('INVALID_DATE_RANGE', 'Periodo de vigencia invalido');
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId }, select: { id: true } });
    if (!product) throw Errors.notFound('PRODUCT_NOT_FOUND', 'Producto no encontrado');
    const currency = await this.prisma.currency.findUnique({ where: { code: dto.currency } });
    if (!currency?.active) throw Errors.badRequest('CURRENCY_NOT_SUPPORTED', `Moneda no habilitada: ${dto.currency}`);
    const userId = getRequestContext()?.userId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.rate.create({
        data: {
          productId: dto.productId, rateCode: dto.rateCode ?? 'BAR', currency: dto.currency, amount: dto.amount, taxesAmount: dto.taxesAmount ?? '0',
          validFrom: asDate(dto.validFrom), validTo: asDate(dto.validTo), providerRateRef: dto.providerRateRef ?? null,
        },
      });
      await tx.rateHistory.create({ data: { rateId: r.id, oldAmount: null, newAmount: r.amount, currency: r.currency, reason: 'Alta de tarifa', changedById: userId } });
      await this.audit.record({ action: 'RATE_CREATED', entity: 'rate', entityId: r.id, after: rateView(r) }, tx);
      return rateView(r);
    });
  }

  async update(id: string, dto: UpdateRateDto) {
    const current = await this.prisma.rate.findUnique({ where: { id } });
    if (!current) throw Errors.notFound('RATE_NOT_FOUND', 'Tarifa no encontrada');
    if (dto.validTo && (!isIsoDate(dto.validTo) || asDate(dto.validTo) < current.validFrom)) throw Errors.badRequest('INVALID_DATE_RANGE', 'validTo invalida');
    const userId = getRequestContext()?.userId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.rate.update({
        where: { id },
        data: {
          ...(dto.amount !== undefined && { amount: dto.amount }), ...(dto.taxesAmount !== undefined && { taxesAmount: dto.taxesAmount }),
          ...(dto.validTo !== undefined && { validTo: asDate(dto.validTo) }), ...(dto.active !== undefined && { active: dto.active }),
        },
      });
      if (!r.amount.equals(current.amount) || !r.taxesAmount.equals(current.taxesAmount)) {
        await tx.rateHistory.create({ data: { rateId: id, oldAmount: current.amount, newAmount: r.amount, currency: r.currency, reason: dto.reason, changedById: userId } });
      }
      await this.audit.record({ action: 'RATE_UPDATED', entity: 'rate', entityId: id, before: rateView(current), after: { ...rateView(r), reason: dto.reason } }, tx);
      return rateView(r);
    });
  }

  async list(q: ListRatesQueryDto) {
    const where: Prisma.RateWhereInput = { ...(q.productId && { productId: q.productId }), ...(q.active !== undefined && { active: q.active }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rate.findMany({ where, orderBy: [{ productId: 'asc' }, { validFrom: 'asc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.rate.count({ where }),
    ]);
    return new PageResult(rows.map(rateView), total, q.page, q.pageSize);
  }

  async history(id: string) {
    if (!(await this.prisma.rate.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound('RATE_NOT_FOUND', 'Tarifa no encontrada');
    const rows = await this.prisma.rateHistory.findMany({ where: { rateId: id }, orderBy: { changedAt: 'desc' }, include: { changedBy: { select: { id: true, email: true } } } });
    return rows.map((h) => ({ ...h, oldAmount: h.oldAmount?.toFixed(2) ?? null, newAmount: h.newAmount.toFixed(2) }));
  }
}
