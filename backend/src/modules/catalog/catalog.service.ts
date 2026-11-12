import { Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';
import { AvailabilitySource, CanonicalHotel, CanonicalProduct, ExternalRef, ProductKind } from '../normalization/canonical';
import { ListProductsQueryDto } from './dto/catalog.dto';

export const PRODUCT_ENTITY = 'product';
export const HOTEL_ENTITY = 'hotel';

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export function productName(p: CanonicalProduct): string {
  if (p.kind === 'FLIGHT') return `${p.carrier} ${p.flightNumber} ${p.origin}-${p.destination} ${p.departureAt.slice(0, 10)}`;
  if (p.kind === 'ROOM') return `${p.hotel.name} - ${p.roomType} (${p.boardBasis})`;
  return p.planName;
}

export interface PersistResult {
  productId: string;
  created: boolean;
  /** El dato del proveedor cambio respecto de la ultima vez (rawHash distinto). */
  changed: boolean;
}

const detailInclude = {
  provider: { select: { id: true, code: true, name: true, type: true } },
  ProductFlightByProductId: true,
  ProductRoomByProductId: { include: { hotel: true } },
  ProductAssistanceByProductId: true,
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

/**
 * Catalogo normalizado: todo producto, venga de un proveedor (PROVIDER_LIVE) o sea cupo propio (ALLOTMENT),
 * existe una sola vez en `products` con su detalle y su referencia externa (external_references).
 * La referencia al proveedor nunca se pierde: se busca primero por external_references y luego por codigo.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserta o actualiza un producto canonico de un proveedor. Seguro ante llamadas concurrentes. */
  async persistProduct(providerId: string, p: CanonicalProduct): Promise<PersistResult> {
    try {
      return await this.prisma.$transaction((tx) => this.persistTx(tx, providerId, p));
    } catch (e) {
      // Otra peticion creo el mismo producto en paralelo: se reintenta y esta vez se encuentra.
      if (isUniqueViolation(e)) return this.prisma.$transaction((tx) => this.persistTx(tx, providerId, p));
      throw e;
    }
  }

  private async persistTx(tx: PrismaTx, providerId: string, p: CanonicalProduct): Promise<PersistResult> {
    const externalId = p.ref.externalId;
    const ref = await tx.externalReference.findUnique({ where: { providerId_entityType_externalId: { providerId, entityType: PRODUCT_ENTITY, externalId } } });
    let product = ref
      ? await tx.product.findUnique({ where: { id: ref.entityId } })
      : await tx.product.findUnique({ where: { providerId_code: { providerId, code: externalId } } });
    const name = productName(p);
    let created = false;
    if (!product) {
      product = await tx.product.create({ data: { providerId, type: p.kind as ProductType, code: externalId, name } });
      created = true;
    } else if (product.name !== name || product.status !== 'ACTIVE') {
      product = await tx.product.update({ where: { id: product.id }, data: { name, status: 'ACTIVE' } });
    }

    const changed = created || !ref || (p.ref.rawHash !== undefined && ref.rawHash !== p.ref.rawHash);
    if (changed || created) await this.writeDetail(tx, product.id, providerId, p);
    const now = new Date();
    if (ref) {
      await tx.externalReference.update({ where: { id: ref.id }, data: { lastSeenAt: now, ...(p.ref.rawHash && { rawHash: p.ref.rawHash }) } });
    } else {
      await tx.externalReference.create({ data: { providerId, entityType: PRODUCT_ENTITY, entityId: product.id, externalId, rawHash: p.ref.rawHash ?? null } });
    }
    return { productId: product.id, created, changed };
  }

  private async writeDetail(tx: PrismaTx, productId: string, providerId: string, p: CanonicalProduct): Promise<void> {
    if (p.kind === 'FLIGHT') {
      const data = {
        carrier: p.carrier, flightNumber: p.flightNumber, origin: p.origin, destination: p.destination,
        departureAt: new Date(p.departureAt), arrivalAt: new Date(p.arrivalAt), cabin: p.cabin,
      };
      await tx.productFlight.upsert({ where: { productId }, update: data, create: { productId, ...data } });
    } else if (p.kind === 'ROOM') {
      const hotelId = await this.persistHotel(tx, providerId, p.hotel);
      const data = { hotelId, roomType: p.roomType, boardBasis: p.boardBasis, maxOccupancy: p.maxOccupancy };
      await tx.productRoom.upsert({ where: { productId }, update: data, create: { productId, ...data } });
    } else {
      const data = {
        planName: p.planName, coverageSummary: p.coverageSummary ?? null, maxDays: p.maxDays ?? null,
        medicalCoverageUsd: p.medicalCoverageUsd ?? null,
      };
      await tx.productAssistance.upsert({ where: { productId }, update: data, create: { productId, ...data } });
    }
  }

  private async persistHotel(tx: PrismaTx, providerId: string, h: CanonicalHotel): Promise<string> {
    const data = { name: h.name, city: h.city, country: h.country, stars: h.stars ?? null, allInclusive: h.allInclusive };
    const ref = await tx.externalReference.findUnique({ where: { providerId_entityType_externalId: { providerId, entityType: HOTEL_ENTITY, externalId: h.ref.externalId } } });
    if (ref) {
      await tx.hotel.update({ where: { id: ref.entityId }, data });
      await tx.externalReference.update({ where: { id: ref.id }, data: { lastSeenAt: new Date() } });
      return ref.entityId;
    }
    // Hotel ya cargado (p. ej. por el seed) con el mismo nombre y ciudad: se vincula en lugar de duplicarlo.
    const existing = await tx.hotel.findFirst({ where: { name: h.name, city: h.city } });
    const hotel = existing ? await tx.hotel.update({ where: { id: existing.id }, data }) : await tx.hotel.create({ data });
    await tx.externalReference.create({ data: { providerId, entityType: HOTEL_ENTITY, entityId: hotel.id, externalId: h.ref.externalId } });
    return hotel.id;
  }

  /** Guarda la disponibilidad observada (cache consultiva). Devuelve true si cambio respecto de la anterior. */
  async recordAvailability(providerId: string, productId: string, date: string, availableQuantity: number): Promise<boolean> {
    const stayDate = new Date(`${date}T00:00:00Z`);
    const prev = await this.prisma.availabilitySnapshot.findUnique({ where: { productId_stayDate: { productId, stayDate } }, select: { availableQuantity: true } });
    await this.prisma.availabilitySnapshot.upsert({
      where: { productId_stayDate: { productId, stayDate } },
      update: { availableQuantity, syncedAt: new Date(), providerId },
      create: { productId, providerId, stayDate, availableQuantity },
    });
    return !prev || prev.availableQuantity !== availableQuantity;
  }

  /** Referencia del producto en su proveedor (lo que se envia al adaptador). */
  async externalRefFor(productId: string, db: PrismaTx | PrismaService = this.prisma): Promise<ExternalRef> {
    const product = await db.product.findUnique({ where: { id: productId }, include: { provider: true } });
    if (!product) throw Errors.notFound('PRODUCT_NOT_FOUND', 'Producto no encontrado');
    const ref = await db.externalReference.findFirst({ where: { providerId: product.providerId, entityType: PRODUCT_ENTITY, entityId: productId } });
    return { providerCode: product.provider.code, externalId: ref?.externalId ?? product.code, ...(ref?.rawHash && { rawHash: ref.rawHash }) };
  }

  /**
   * Fuente de inventario de un producto para unas fechas: ALLOTMENT si hay cupo propio (inventory_levels)
   * cargado para todas ellas; si no, PROVIDER_LIVE (se consulta al proveedor).
   */
  async inventorySource(productId: string, dates: string[], db: PrismaTx | PrismaService = this.prisma): Promise<AvailabilitySource> {
    if (dates.length === 0) return 'PROVIDER_LIVE';
    const levels = await db.inventoryLevel.count({ where: { productId, stayDate: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } } });
    return levels === dates.length ? 'ALLOTMENT' : 'PROVIDER_LIVE';
  }

  // ---------------- API ----------------

  private toView(p: ProductRow) {
    const f = p.ProductFlightByProductId;
    const r = p.ProductRoomByProductId;
    const a = p.ProductAssistanceByProductId;
    return {
      id: p.id, code: p.code, name: p.name, type: p.type, status: p.status, provider: p.provider, createdAt: p.createdAt, updatedAt: p.updatedAt,
      ...(f && { flight: { carrier: f.carrier, flightNumber: f.flightNumber, origin: f.origin, destination: f.destination, departureAt: f.departureAt, arrivalAt: f.arrivalAt, cabin: f.cabin } }),
      ...(r && { room: { roomType: r.roomType, boardBasis: r.boardBasis, maxOccupancy: r.maxOccupancy, hotel: r.hotel } }),
      ...(a && { assistance: { planName: a.planName, coverageSummary: a.coverageSummary, maxDays: a.maxDays, medicalCoverageUsd: a.medicalCoverageUsd?.toFixed(2) ?? null } }),
    };
  }

  async list(q: ListProductsQueryDto) {
    const where: Prisma.ProductWhereInput = {
      ...(q.type && { type: q.type as ProductKind }),
      ...(q.providerId && { providerId: q.providerId }),
      ...(q.status && { status: q.status }),
      ...(q.search && { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, include: detailInclude, orderBy: [{ type: 'asc' }, { name: 'asc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.product.count({ where }),
    ]);
    return new PageResult(rows.map((r) => this.toView(r)), total, q.page, q.pageSize);
  }

  async get(id: string) {
    const row = await this.prisma.product.findUnique({ where: { id }, include: detailInclude });
    if (!row) throw Errors.notFound('PRODUCT_NOT_FOUND', 'Producto no encontrado');
    const refs = await this.prisma.externalReference.findMany({ where: { entityType: PRODUCT_ENTITY, entityId: id }, select: { externalId: true, rawHash: true, firstSeenAt: true, lastSeenAt: true } });
    return { ...this.toView(row), externalReferences: refs };
  }
}
