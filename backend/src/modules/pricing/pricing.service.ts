import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { toCents } from '../../common/money/money';
import { AvailabilitySource, ExternalRef, ProductKind } from '../normalization/canonical';
import { CatalogService } from '../catalog/catalog.service';
import { InventoryService } from '../inventory/inventory.service';
import { IntegrationEngine } from '../integration-engine/integration-engine.service';
import { RatesService } from '../rates/rates.service';
import { inventoryDates, lastRateDate, rateUnits, stayError } from './stay';

export interface ItemRequest {
  productId: string;
  startDate: string;
  endDate?: string | null;
  quantity: number;
}

export interface PricedItem {
  productId: string;
  providerId: string;
  kind: ProductKind;
  source: AvailabilitySource;
  /** Total del item (unidades x noches) en su moneda de origen. */
  totalCents: number;
  taxesCents: number;
  currency: string;
  rateCode: string;
  rateId: string | null;
  providerRateRef: string | null;
  refundable: boolean | null;
  /** Cupo propio disponible (ALLOTMENT); null en PROVIDER_LIVE (se revalida antes de confirmar). */
  available: number | null;
  integrationId: string | null;
  externalRef: ExternalRef;
  transactionId: string | null;
}

/**
 * Precio de un item en su moneda de origen.
 *  - ALLOTMENT: tarifa propia vigente (rates) que cubra el periodo completo, por noche o por unidad.
 *  - PROVIDER_LIVE: tarifa consultada al proveedor por el motor de integracion (precio vigente, no cache).
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly rates: RatesService,
    private readonly engine: IntegrationEngine,
  ) {}

  async price(req: ItemRequest): Promise<PricedItem> {
    const product = await this.catalogProduct(req.productId);
    const kind = product.type as ProductKind;
    const err = stayError(kind, req.startDate, req.endDate);
    if (err) throw Errors.badRequest('INVALID_STAY', err, { productId: req.productId });
    if (!Number.isInteger(req.quantity) || req.quantity < 1 || req.quantity > 20) throw Errors.badRequest('INVALID_QUANTITY', 'quantity debe estar entre 1 y 20');

    const dates = inventoryDates(kind, req.startDate, req.endDate);
    const source = await this.catalog.inventorySource(req.productId, dates);
    const externalRef = await this.catalog.externalRefFor(req.productId);
    const base = { productId: req.productId, providerId: product.providerId, kind, source, externalRef };

    if (source === 'ALLOTMENT') {
      const rate = await this.rates.findApplicable(req.productId, req.startDate, lastRateDate(kind, req.startDate, req.endDate));
      if (!rate) throw Errors.unprocessable('RATE_NOT_FOUND', 'No hay tarifa vigente que cubra el periodo completo', { productId: req.productId });
      const units = rateUnits(kind, req.startDate, req.endDate) * req.quantity;
      const unit = toCents(rate.amount.toFixed(2));
      const tax = toCents(rate.taxesAmount.toFixed(2));
      return {
        ...base, totalCents: (unit + tax) * units, taxesCents: tax * units, currency: rate.currency, rateCode: rate.rateCode, rateId: rate.id,
        providerRateRef: rate.providerRateRef, refundable: null, available: await this.inventory.available(req.productId, dates),
        integrationId: null, transactionId: null,
      };
    }

    const integration = await this.engine.resolveForProvider(product.providerId);
    if (!integration) throw Errors.conflict('PROVIDER_NOT_AVAILABLE', 'El proveedor del producto no tiene una integracion habilitada', { productId: req.productId });
    const r = await this.engine.getRates(integration.id, {
      products: [externalRef], startDate: req.startDate, ...(req.endDate && { endDate: req.endDate }), quantity: req.quantity,
    });
    if (!r.ok) {
      throw Errors.unavailable('PROVIDER_ERROR', `El proveedor no devolvio tarifa: ${r.error.message}`, { code: r.error.code, engineCode: r.error.engineCode, transactionId: r.transactionId });
    }
    const rate = r.data.rates.find((x) => x.ref.externalId === externalRef.externalId);
    if (!rate) throw Errors.conflict('NO_RATE', 'El proveedor no ofrece tarifa para ese producto y fechas', { productId: req.productId, transactionId: r.transactionId });
    if (rate.total.currency !== rate.taxes.currency) throw Errors.unavailable('PROVIDER_ERROR', 'Tarifa del proveedor con monedas inconsistentes');
    return {
      ...base, totalCents: toCents(rate.total.amount), taxesCents: toCents(rate.taxes.amount), currency: rate.total.currency, rateCode: rate.rateCode, rateId: null,
      providerRateRef: rate.providerRateRef ?? null, refundable: rate.refundable ?? null, available: null, integrationId: integration.id, transactionId: r.transactionId,
    };
  }

  private async catalogProduct(productId: string) {
    const p = await this.prisma.product.findUnique({ where: { id: productId }, select: { type: true, providerId: true, status: true } });
    if (!p) throw Errors.notFound('PRODUCT_NOT_FOUND', 'Producto no encontrado');
    if (p.status !== 'ACTIVE') throw Errors.conflict('PRODUCT_INACTIVE', 'El producto no esta activo');
    return p;
  }
}
