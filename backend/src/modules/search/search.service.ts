import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AppException, Errors } from '../../common/errors/app.exception';
import { fromCents, toCents } from '../../common/money/money';
import { AvailabilityQuery, AvailabilitySource, CanonicalAvailability, CanonicalProduct, ExternalRef, ProductKind } from '../normalization/canonical';
import { CatalogService, HOTEL_ENTITY, productName } from '../catalog/catalog.service';
import { InventoryService } from '../inventory/inventory.service';
import { IntegrationEngine } from '../integration-engine/integration-engine.service';
import { PricingService } from '../pricing/pricing.service';
import { inventoryDates, stayError } from '../pricing/stay';
import { SearchDto } from './dto/search.dto';

export interface Offer {
  productId: string;
  name: string;
  kind: ProductKind;
  source: AvailabilitySource;
  provider: { id: string; code: string; name: string };
  startDate: string;
  endDate: string | null;
  quantity: number;
  available: number;
  price: { total: string; taxes: string; currency: string } | null;
  rateCode: string | null;
  refundable: boolean | null;
  product?: CanonicalProduct;
}

export interface ProviderOutcome {
  providerId: string;
  code: string;
  source: AvailabilitySource;
  ok: boolean;
  offers: number;
  transactionId: string | null;
  error?: { code: string; message: string; engineCode?: string };
}

const MAX_RATE_BATCH = 50;
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Busqueda unificada: cupo propio (ALLOTMENT, desde la base) + proveedores en vivo (PROVIDER_LIVE, por el
 * motor de integracion, en paralelo). La falla de un proveedor no tumba la busqueda: se informa en
 * `providers` y el resto de las ofertas se devuelve igual.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly pricing: PricingService,
    private readonly engine: IntegrationEngine,
  ) {}

  async search(dto: SearchDto): Promise<{ offers: Offer[]; providers: ProviderOutcome[] }> {
    const err = stayError(dto.kind, dto.startDate, dto.endDate);
    if (err) throw Errors.badRequest('INVALID_STAY', err);
    const dates = inventoryDates(dto.kind, dto.startDate, dto.endDate);

    const allotmentProviders = new Set(
      (await this.prisma.allotment.findMany({ where: { active: true }, select: { product: { select: { providerId: true } } } })).map((a) => a.product.providerId),
    );
    const [local, live] = await Promise.all([this.searchAllotment(dto, dates), this.searchLive(dto, dates, allotmentProviders)]);
    const offers = [...local.offers, ...live.offers].sort((a, b) => {
      if (!a.price || !b.price) return a.price ? -1 : b.price ? 1 : 0;
      return a.price.currency.localeCompare(b.price.currency) || toCents(a.price.total) - toCents(b.price.total);
    });
    return { offers, providers: [...local.providers, ...live.providers] };
  }

  // ---------------- cupo propio ----------------

  private async searchAllotment(dto: SearchDto, dates: string[]): Promise<{ offers: Offer[]; providers: ProviderOutcome[] }> {
    if (dates.length === 0) return { offers: [], providers: [] };
    const where: Prisma.ProductWhereInput = {
      type: dto.kind as ProductType,
      status: 'ACTIVE',
      provider: { active: true },
      ...(dto.providerIds && { providerId: { in: dto.providerIds } }),
      ...(dto.kind === 'FLIGHT' && (dto.origin || dto.destination) && {
        ProductFlightByProductId: { ...(dto.origin && { origin: dto.origin }), ...(dto.destination && { destination: dto.destination }) },
      }),
    };
    const candidates = await this.prisma.product.findMany({
      where: { ...where, inventoryLevelsByProductId: { some: { stayDate: asDate(dates[0]) } } },
      include: { provider: { select: { id: true, code: true, name: true } }, ProductRoomByProductId: { select: { hotelId: true, maxOccupancy: true } } },
    });

    let hotelFilter: Set<string> | null = null;
    if (dto.kind === 'ROOM' && dto.hotelExternalId) {
      const refs = await this.prisma.externalReference.findMany({ where: { entityType: HOTEL_ENTITY, externalId: dto.hotelExternalId }, select: { entityId: true } });
      hotelFilter = new Set(refs.map((r) => r.entityId));
    }

    const offers: Offer[] = [];
    const byProvider = new Map<string, ProviderOutcome>();
    for (const p of candidates) {
      if (hotelFilter && !(p.ProductRoomByProductId && hotelFilter.has(p.ProductRoomByProductId.hotelId))) continue;
      if (dto.adults !== undefined && p.ProductRoomByProductId && dto.adults > p.ProductRoomByProductId.maxOccupancy * dto.quantity) continue;
      const available = await this.inventory.available(p.id, dates);
      if (available < dto.quantity) continue;
      const outcome = byProvider.get(p.providerId) ?? { providerId: p.providerId, code: p.provider.code, source: 'ALLOTMENT' as const, ok: true, offers: 0, transactionId: null };
      byProvider.set(p.providerId, outcome);
      try {
        const priced = await this.pricing.price({ productId: p.id, startDate: dto.startDate, endDate: dto.endDate, quantity: dto.quantity });
        offers.push({
          productId: p.id, name: p.name, kind: dto.kind, source: 'ALLOTMENT', provider: p.provider, startDate: dto.startDate, endDate: dto.endDate ?? null,
          quantity: dto.quantity, available, rateCode: priced.rateCode, refundable: priced.refundable,
          price: { total: fromCents(priced.totalCents), taxes: fromCents(priced.taxesCents), currency: priced.currency },
        });
        outcome.offers++;
      } catch (e) {
        // Sin tarifa vigente el cupo existe pero no se puede vender: no se ofrece.
        if (!(e instanceof AppException)) throw e;
        this.logger.warn(`Producto ${p.code} con cupo pero sin tarifa: ${e.message}`);
      }
    }
    return { offers, providers: [...byProvider.values()] };
  }

  // ---------------- proveedores en vivo ----------------

  private async searchLive(dto: SearchDto, dates: string[], allotmentProviders: Set<string>): Promise<{ offers: Offer[]; providers: ProviderOutcome[] }> {
    const providers = await this.prisma.provider.findMany({
      where: {
        active: true,
        ...(dto.providerIds && { id: { in: dto.providerIds } }),
        providerServicesByProviderId: { some: { serviceType: dto.kind as ProductType, canSearch: true } },
        integrationsByProviderId: { some: { enabled: true } },
      },
      select: { id: true, code: true, name: true },
    });
    const targets = providers.filter((p) => !allotmentProviders.has(p.id));
    const query: AvailabilityQuery = {
      kind: dto.kind, startDate: dto.startDate, ...(dto.endDate && { endDate: dto.endDate }), quantity: dto.quantity,
      ...(dto.origin && { origin: dto.origin }), ...(dto.destination && { destination: dto.destination }),
      ...(dto.hotelExternalId && { hotelExternalId: dto.hotelExternalId }), ...(dto.adults !== undefined && { adults: dto.adults }),
    };
    const results = await Promise.all(targets.map((p) => this.searchProvider(p, query, dates, dto)));
    return { offers: results.flatMap((r) => r.offers), providers: results.map((r) => r.outcome) };
  }

  private async searchProvider(p: { id: string; code: string; name: string }, query: AvailabilityQuery, dates: string[], dto: SearchDto): Promise<{ offers: Offer[]; outcome: ProviderOutcome }> {
    const outcome: ProviderOutcome = { providerId: p.id, code: p.code, source: 'PROVIDER_LIVE', ok: false, offers: 0, transactionId: null };
    const integration = await this.engine.resolveForProvider(p.id);
    if (!integration) return { offers: [], outcome: { ...outcome, error: { code: 'UNAVAILABLE', message: 'Sin integracion habilitada' } } };

    const r = await this.engine.search(integration.id, query);
    outcome.transactionId = r.transactionId;
    if (!r.ok) return { offers: [], outcome: { ...outcome, error: { code: r.error.code, message: r.error.message, engineCode: r.error.engineCode } } };

    // Agrupa por producto: una habitacion es ofertable solo si todas las noches tienen cupo suficiente.
    const groups = new Map<string, { product: CanonicalProduct; byDate: Map<string, CanonicalAvailability> }>();
    for (const item of r.data.items) {
      const g = groups.get(item.product.ref.externalId) ?? { product: item.product, byDate: new Map() };
      g.byDate.set(item.date, item);
      groups.set(item.product.ref.externalId, g);
    }
    const sellable: Array<{ productId: string; product: CanonicalProduct; available: number }> = [];
    for (const g of groups.values()) {
      const needed = dates.length > 0 ? dates : [...g.byDate.keys()];
      const quantities = needed.map((d) => g.byDate.get(d)?.availableQuantity ?? 0);
      const available = Math.min(...quantities);
      const persisted = await this.catalog.persistProduct(p.id, g.product);
      for (const [d, a] of g.byDate) await this.catalog.recordAvailability(p.id, persisted.productId, d, a.availableQuantity);
      if (available >= dto.quantity) sellable.push({ productId: persisted.productId, product: g.product, available });
    }

    const prices = await this.ratesFor(integration.id, sellable.map((s) => s.product.ref), dto);
    const offers: Offer[] = sellable.map((s) => {
      const rate = prices.get(s.product.ref.externalId);
      return {
        productId: s.productId, name: productName(s.product), kind: dto.kind, source: 'PROVIDER_LIVE', provider: { id: p.id, code: p.code, name: p.name },
        startDate: dto.startDate, endDate: dto.endDate ?? null, quantity: dto.quantity, available: s.available,
        price: rate ? { total: rate.total.amount, taxes: rate.taxes.amount, currency: rate.total.currency } : null,
        rateCode: rate?.rateCode ?? null, refundable: rate?.refundable ?? null, product: s.product,
      };
    });
    return { offers, outcome: { ...outcome, ok: true, offers: offers.length } };
  }

  private async ratesFor(integrationId: string, refs: ExternalRef[], dto: SearchDto) {
    const out = new Map<string, { total: { amount: string; currency: string }; taxes: { amount: string }; rateCode: string; refundable?: boolean }>();
    for (let i = 0; i < refs.length; i += MAX_RATE_BATCH) {
      const r = await this.engine.getRates(integrationId, {
        products: refs.slice(i, i + MAX_RATE_BATCH), startDate: dto.startDate, ...(dto.endDate && { endDate: dto.endDate }), quantity: dto.quantity,
      });
      if (!r.ok) continue; // sin tarifa la oferta sale con price = null; la cotizacion vuelve a consultar
      for (const rate of r.data.rates) if (!out.has(rate.ref.externalId)) out.set(rate.ref.externalId, rate);
    }
    return out;
  }
}
