import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import type { Env } from '../../common/config/env.validation';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { fromCents } from '../../common/money/money';
import { newReference } from '../../common/references/reference';
import { toIsoDate } from '../../common/time/dates';
import { AuditService } from '../audit/audit.service';
import { ExchangeRatesService } from '../pricing/exchange-rates.service';
import { PricedItem, PricingService } from '../pricing/pricing.service';
import { CreateQuoteDto, ListQuotesQueryDto } from './dto/quotes.dto';

const include = {
  quoteItemsByQuoteId: { include: { product: { select: { id: true, code: true, name: true, type: true, provider: { select: { id: true, code: true, name: true } } } } } },
} satisfies Prisma.QuoteInclude;
type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof include }>;

export function quoteView(q: QuoteRow) {
  return {
    id: q.id, reference: q.reference, status: q.status, currency: q.currency, totalAmount: q.totalAmount.toFixed(2),
    expiresAt: q.expiresAt, createdAt: q.createdAt,
    items: q.quoteItemsByQuoteId.map((i) => ({
      id: i.id, product: i.product, quantity: i.quantity, startDate: toIsoDate(i.startDate), endDate: i.endDate ? toIsoDate(i.endDate) : null,
      unitAmount: i.unitAmount.toFixed(2), totalAmount: i.unitAmount.mul(i.quantity).toFixed(2),
      source: { currency: i.sourceCurrency, amount: i.sourceAmount?.toFixed(2) ?? null }, rateId: i.rateId, providerQuoteRef: i.providerQuoteRef,
    })),
  };
}

/**
 * Cotizacion: precio vigente de cada item (tarifa propia o consulta al proveedor), convertido a una sola moneda.
 * Guarda el precio de origen (source_*): es el que se exige al proveedor al confirmar y contra el que se
 * detecta un cambio de precio, sin confundirlo con una variacion del tipo de cambio.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fx: ExchangeRatesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(dto: CreateQuoteDto) {
    const currency = await this.prisma.currency.findUnique({ where: { code: dto.currency } });
    if (!currency?.active) throw Errors.badRequest('CURRENCY_NOT_SUPPORTED', `Moneda no habilitada: ${dto.currency}`);

    const priced: Array<{ req: CreateQuoteDto['items'][number]; p: PricedItem; unitCents: number }> = [];
    for (const req of dto.items) {
      const p = await this.pricing.price(req);
      if (p.source === 'ALLOTMENT' && (p.available ?? 0) < req.quantity) {
        throw Errors.conflict('NO_AVAILABILITY', 'No hay cupo suficiente para el producto en esas fechas', { productId: req.productId, available: p.available });
      }
      const converted = await this.fx.convert(p.totalCents, p.currency, dto.currency);
      priced.push({ req, p, unitCents: Math.round(converted.cents / req.quantity) });
    }
    const totalCents = priced.reduce((s, x) => s + x.unitCents * x.req.quantity, 0);
    const ttlMs = this.config.get('QUOTE_TTL_MINUTES', { infer: true }) * 60_000;
    const userId = getRequestContext()?.userId ?? null;

    const quote = await this.prisma.$transaction(async (tx) => {
      const q = await tx.quote.create({
        data: {
          reference: newReference('Q'), currency: dto.currency, totalAmount: fromCents(totalCents), expiresAt: new Date(Date.now() + ttlMs), createdById: userId,
          quoteItemsByQuoteId: {
            create: priced.map(({ req, p, unitCents }) => ({
              productId: req.productId, rateId: p.rateId, quantity: req.quantity, unitAmount: fromCents(unitCents),
              startDate: new Date(`${req.startDate}T00:00:00Z`), endDate: req.endDate ? new Date(`${req.endDate}T00:00:00Z`) : null,
              providerQuoteRef: p.providerRateRef, sourceCurrency: p.currency, sourceAmount: fromCents(p.totalCents),
            })),
          },
        },
        include,
      });
      await this.audit.record({ action: 'QUOTE_CREATED', entity: 'quote', entityId: q.id, after: { reference: q.reference, total: q.totalAmount.toFixed(2), currency: q.currency } }, tx);
      return q;
    });
    return quoteView(quote);
  }

  async get(id: string) {
    const q = await this.prisma.quote.findUnique({ where: { id }, include });
    if (!q) throw Errors.notFound('QUOTE_NOT_FOUND', 'Cotizacion no encontrada');
    return quoteView(q);
  }

  async list(q: ListQuotesQueryDto) {
    const where: Prisma.QuoteWhereInput = { ...(q.status && { status: q.status }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.quote.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.quote.count({ where }),
    ]);
    return new PageResult(rows.map(quoteView), total, q.page, q.pageSize);
  }

  /** Vence las cotizaciones abiertas cuya vigencia termino (lo llama el planificador). */
  async expireStale(): Promise<number> {
    const r = await this.prisma.quote.updateMany({ where: { status: 'OPEN', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
    return r.count;
  }
}
