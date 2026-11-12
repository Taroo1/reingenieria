/**
 * Seed de datos iniciales (idempotente: se puede ejecutar varias veces).
 *  - Roles, usuarios iniciales (contrasenas SOLO desde variables de entorno), monedas.
 *  - Proveedores de ejemplo con integracion SIMULADA, un proveedor HTTP apuntando al simulador de la Etapa 3
 *    (deshabilitado hasta que exista) y Boomi como "preparado, sin conexion real".
 *  - Catalogo, allotments, inventario y tarifas de ejemplo (datos ficticios).
 * Ninguna credencial de proveedor se siembra: los datos de ejemplo no llevan secretos.
 */
import { PrismaClient, ProductType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;
const INVENTORY_DAYS = 60;

function requireSeedPassword(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('CHANGE_ME')) {
    throw new Error(`${name} esta vacia o es un marcador. Ejecute infrastructure/scripts/setup-env.sh (o .ps1) o defina una contrasena propia.`);
  }
  if (value.length < 12) throw new Error(`${name} debe tener al menos 12 caracteres.`);
  return value;
}

const utcDay = (offsetDays: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY_MS);
};

async function seedRolesAndUsers(): Promise<void> {
  const roles: Array<[string, string]> = [
    ['ADMIN', 'Administracion total del sistema'],
    ['OPERADOR', 'Opera inventario, tarifas, reservas y excepciones'],
    ['CONSULTA', 'Solo lectura'],
  ];
  for (const [name, description] of roles) {
    await prisma.role.upsert({ where: { name }, update: { description }, create: { name, description } });
  }

  const users = [
    { role: 'ADMIN', email: process.env.SEED_ADMIN_EMAIL, pass: 'SEED_ADMIN_PASSWORD', fullName: 'Administrador' },
    { role: 'OPERADOR', email: process.env.SEED_OPERATOR_EMAIL, pass: 'SEED_OPERATOR_PASSWORD', fullName: 'Operador' },
    { role: 'CONSULTA', email: process.env.SEED_VIEWER_EMAIL, pass: 'SEED_VIEWER_PASSWORD', fullName: 'Consulta' },
  ];
  for (const u of users) {
    const email = u.email?.trim().toLowerCase();
    if (!email) throw new Error(`Falta el correo del usuario ${u.role} en el entorno.`);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) continue; // nunca se pisa la contrasena de un usuario existente
    const role = await prisma.role.findUniqueOrThrow({ where: { name: u.role } });
    const passwordHash = await argon2.hash(requireSeedPassword(u.pass), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.user.create({ data: { email, fullName: u.fullName, passwordHash, roleId: role.id } });
    console.log(`  usuario creado: ${email} (${u.role})`);
  }
}

async function seedCurrencies(): Promise<void> {
  const list = [
    { code: 'USD', name: 'Dolar estadounidense', decimals: 2 },
    { code: 'EUR', name: 'Euro', decimals: 2 },
    { code: 'ARS', name: 'Peso argentino', decimals: 2 },
  ];
  for (const c of list) await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });

  // Tipos de cambio FICTICIOS de ejemplo (no son cotizaciones reales): permiten cotizar en una sola moneda
  // items de proveedores que venden en otra. En produccion se cargan desde una fuente oficial.
  const asOf = new Date('2026-01-01T00:00:00Z');
  const fx: Array<[string, string, string]> = [
    ['USD', 'EUR', '0.92000000'],
    ['EUR', 'USD', '1.08695652'],
    ['USD', 'ARS', '1050.00000000'],
    ['EUR', 'ARS', '1141.30434783'],
  ];
  for (const [baseCurrency, quoteCurrency, rate] of fx) {
    await prisma.exchangeRate.upsert({
      where: { baseCurrency_quoteCurrency_asOf: { baseCurrency, quoteCurrency, asOf } },
      update: {},
      create: { baseCurrency, quoteCurrency, rate, asOf, source: 'seed: valores ficticios de ejemplo' },
    });
  }
}

interface ProviderSeed {
  code: string;
  name: string;
  type: 'GDS' | 'AIRLINE' | 'CONSOLIDATOR' | 'HOTEL' | 'BEDBANK' | 'TRAVEL_ASSISTANCE';
  adapterKind: 'SIMULATED' | 'HTTP' | 'BOOMI';
  services: ProductType[];
  enabled: boolean;
  description: string;
  /** Si se omite: OWN_HOTEL, aerolineas y GDS permiten bloqueo previo. */
  canHold?: boolean;
  http?: { baseUrl: string; supportsIdempotency: boolean };
}

/** URL del simulador de proveedores (Etapa 3). Cada proveedor ficticio vive bajo /p/<CODIGO>. */
const SIMULATOR_URL = (process.env.SEED_SIMULATOR_URL?.trim() || process.env.SIMULATOR_URL?.trim() || 'http://localhost:4100').replace(/\/+$/, '');
const sim = (code: string) => `${SIMULATOR_URL}/p/${code}`;

const PROVIDERS: ProviderSeed[] = [
  { code: 'SIM_GDS', name: 'GDS Simulado', type: 'GDS', adapterKind: 'SIMULATED', services: ['FLIGHT'], enabled: true, description: 'GDS ficticio para pruebas (adaptador en memoria)' },
  { code: 'SIM_AIRLINE', name: 'Aerolinea Simulada', type: 'AIRLINE', adapterKind: 'SIMULATED', services: ['FLIGHT'], enabled: true, description: 'Aerolinea ficticia: disponibilidad en vivo' },
  { code: 'SIM_CONSOLIDATOR', name: 'Consolidador Simulado', type: 'CONSOLIDATOR', adapterKind: 'SIMULATED', services: ['FLIGHT'], enabled: true, description: 'Consolidador ficticio' },
  { code: 'OWN_HOTEL', name: 'Hoteles Contratados (allotment propio)', type: 'HOTEL', adapterKind: 'SIMULATED', services: ['ROOM'], enabled: true, description: 'Cupos contratados: la base de datos es la fuente de verdad' },
  { code: 'SIM_BEDBANK', name: 'Bedbank Simulado', type: 'BEDBANK', adapterKind: 'SIMULATED', services: ['ROOM'], enabled: true, description: 'Bedbank ficticio: disponibilidad en vivo' },
  { code: 'SIM_ASSIST', name: 'Asistencia al Viajero Simulada', type: 'TRAVEL_ASSISTANCE', adapterKind: 'SIMULATED', services: ['ASSISTANCE_PLAN'], enabled: true, description: 'Planes de asistencia ficticios' },
  {
    code: 'SIM_HTTP', name: 'SkyJet Airlines (HTTP, simulador)', type: 'AIRLINE', adapterKind: 'HTTP', services: ['FLIGHT'], enabled: false,
    description: 'Aerolinea ficticia SKYJET del provider-simulator. No deduplica reservas ni soporta Idempotency-Key. Se habilita con el simulador corriendo.',
    http: { baseUrl: sim('SKYJET'), supportsIdempotency: false },
  },
  {
    code: 'HTTP_GDS', name: 'Global GDS (HTTP, simulador)', type: 'GDS', adapterKind: 'HTTP', services: ['FLIGHT'], enabled: false,
    description: 'GDS ficticio GLOBALGDS del provider-simulator. Soporta Idempotency-Key.',
    http: { baseUrl: sim('GLOBALGDS'), supportsIdempotency: true },
  },
  {
    code: 'HTTP_CONSOLIDATOR', name: 'Consolida Viajes (HTTP, simulador)', type: 'CONSOLIDATOR', adapterKind: 'HTTP', services: ['FLIGHT'], enabled: false, canHold: false,
    description: 'Consolidador ficticio CONSOLIDA del provider-simulator. Sin bloqueo previo.',
    http: { baseUrl: sim('CONSOLIDA'), supportsIdempotency: true },
  },
  {
    code: 'HTTP_HOTEL', name: 'HotelNet (HTTP, simulador)', type: 'HOTEL', adapterKind: 'HTTP', services: ['ROOM'], enabled: false, canHold: true,
    description: 'Hotelera ficticia HOTELNET del provider-simulator. Confirma a pedido (PENDING y luego CONFIRMED).',
    http: { baseUrl: sim('HOTELNET'), supportsIdempotency: true },
  },
  {
    code: 'HTTP_BEDBANK', name: 'BedsPlus (HTTP, simulador)', type: 'BEDBANK', adapterKind: 'HTTP', services: ['ROOM'], enabled: false, canHold: false,
    description: 'Bedbank ficticio BEDSPLUS del provider-simulator (EUR). Sin bloqueo previo.',
    http: { baseUrl: sim('BEDSPLUS'), supportsIdempotency: true },
  },
  {
    code: 'HTTP_ASSIST', name: 'AssistPro (HTTP, simulador)', type: 'TRAVEL_ASSISTANCE', adapterKind: 'HTTP', services: ['ASSISTANCE_PLAN'], enabled: false, canHold: false,
    description: 'Asistencia al viajero ficticia ASSISTPRO del provider-simulator.',
    http: { baseUrl: sim('ASSISTPRO'), supportsIdempotency: true },
  },
  {
    code: 'BOOMI_PENDING', name: 'Boomi (pendiente de credenciales)', type: 'CONSOLIDATOR', adapterKind: 'BOOMI', services: ['FLIGHT', 'ROOM'], enabled: false,
    description: 'Integracion preparada. SIN conexion real: requiere credenciales, licencia y documentacion oficial de Boomi.',
  },
];

async function seedProviders(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of PROVIDERS) {
    const provider = await prisma.provider.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, name: p.name, type: p.type, description: p.description },
    });
    ids.set(p.code, provider.id);

    if (p.http) {
      await prisma.providerConfig.upsert({
        where: { providerId: provider.id },
        update: {},
        create: {
          providerId: provider.id,
          baseUrl: p.http.baseUrl,
          authType: 'NONE',
          timeoutMs: 3000,
          maxRetries: 3,
          supportsIdempotency: p.http.supportsIdempotency,
          params: { healthPath: '/health' },
        },
      });
    }
    for (const serviceType of p.services) {
      const canHold = p.canHold ?? (p.code === 'OWN_HOTEL' || p.type === 'AIRLINE' || p.type === 'GDS');
      await prisma.providerService.upsert({
        where: { providerId_serviceType: { providerId: provider.id, serviceType } },
        update: {},
        create: { providerId: provider.id, serviceType, canHold },
      });
    }
    const integration = await prisma.integration.upsert({
      where: { providerId_name: { providerId: provider.id, name: `${p.code}_${p.adapterKind}` } },
      update: {},
      create: { providerId: provider.id, name: `${p.code}_${p.adapterKind}`, adapterKind: p.adapterKind, enabled: p.enabled },
    });
    await prisma.circuitBreakerState.upsert({ where: { integrationId: integration.id }, update: {}, create: { integrationId: integration.id } });
  }
  return ids;
}

async function ensureProduct(providerId: string, type: ProductType, code: string, name: string): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.product.findUnique({ where: { providerId_code: { providerId, code } } });
  if (existing) return { id: existing.id, created: false };
  const created = await prisma.product.create({ data: { providerId, type, code, name } });
  return { id: created.id, created: true };
}

async function seedCatalog(providers: Map<string, string>): Promise<void> {
  const hotelProvider = providers.get('OWN_HOTEL')!;
  const bedbank = providers.get('SIM_BEDBANK')!;
  const airline = providers.get('SIM_AIRLINE')!;
  const assist = providers.get('SIM_ASSIST')!;

  // Hoteles y habitaciones con allotment propio (inventario ALLOTMENT).
  const hotels = [
    { name: 'Gran Caribe Resort', city: 'Punta Cana', country: 'DO', stars: 5, allInclusive: true },
    { name: 'Playa Azul Beach Hotel', city: 'Cancun', country: 'MX', stars: 4, allInclusive: true },
  ];
  const roomTypes = [
    { type: 'DOUBLE', occupancy: 2, qty: 12, amount: 180 },
    { type: 'FAMILY', occupancy: 4, qty: 6, amount: 290 },
  ];
  for (const h of hotels) {
    let hotel = await prisma.hotel.findFirst({ where: { name: h.name } });
    if (!hotel) hotel = await prisma.hotel.create({ data: h });
    for (const r of roomTypes) {
      const code = `ROOM-${h.name.split(' ')[0].toUpperCase()}-${r.type}`;
      const product = await ensureProduct(hotelProvider, 'ROOM', code, `${h.name} - ${r.type}`);
      if (!product.created) continue;
      await prisma.productRoom.create({ data: { productId: product.id, hotelId: hotel.id, roomType: r.type, maxOccupancy: r.occupancy } });
      await prisma.allotment.create({
        data: { productId: product.id, validFrom: utcDay(0), validTo: utcDay(INVENTORY_DAYS - 1), quantity: r.qty, releaseDays: 7, notes: 'Cupo de ejemplo (seed)' },
      });
      await prisma.inventoryLevel.createMany({
        data: Array.from({ length: INVENTORY_DAYS }, (_, i) => ({ productId: product.id, stayDate: utcDay(i), totalQuantity: r.qty })),
        skipDuplicates: true,
      });
      const levels = await prisma.inventoryLevel.findMany({ where: { productId: product.id }, select: { id: true, totalQuantity: true } });
      await prisma.inventoryMovement.createMany({
        data: levels.map((l) => ({ levelId: l.id, kind: 'LOAD' as const, deltaTotal: l.totalQuantity, referenceType: 'seed' })),
      });
      await prisma.rate.create({
        data: { productId: product.id, currency: 'USD', amount: r.amount, taxesAmount: Math.round(r.amount * 0.1), validFrom: utcDay(0), validTo: utcDay(INVENTORY_DAYS - 1) },
      });
    }
  }

  // Habitacion de bedbank (inventario en vivo): solo cache de disponibilidad, sin allotment.
  const bb = await ensureProduct(bedbank, 'ROOM', 'BB-ROOM-001', 'Hotel Centro Madrid - Doble (bedbank)');
  if (bb.created) {
    let hotel = await prisma.hotel.findFirst({ where: { name: 'Hotel Centro Madrid' } });
    if (!hotel) hotel = await prisma.hotel.create({ data: { name: 'Hotel Centro Madrid', city: 'Madrid', country: 'ES', stars: 4, allInclusive: false } });
    await prisma.productRoom.create({ data: { productId: bb.id, hotelId: hotel.id, roomType: 'DOUBLE', boardBasis: 'BREAKFAST', maxOccupancy: 2 } });
    await prisma.availabilitySnapshot.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({ productId: bb.id, providerId: bedbank, stayDate: utcDay(i), availableQuantity: 5 })),
      skipDuplicates: true,
    });
    await prisma.rate.create({ data: { productId: bb.id, currency: 'EUR', amount: 140, taxesAmount: 14, validFrom: utcDay(0), validTo: utcDay(29) } });
  }

  // Vuelos de aerolinea (inventario en vivo).
  const flights = [
    { code: 'FL-AR1304', carrier: 'AR', number: 'AR1304', origin: 'EZE', destination: 'PUJ', dep: 10, hours: 6, amount: 620 },
    { code: 'FL-AR1306', carrier: 'AR', number: 'AR1306', origin: 'EZE', destination: 'CUN', dep: 12, hours: 8, amount: 710 },
  ];
  for (const f of flights) {
    const product = await ensureProduct(airline, 'FLIGHT', f.code, `${f.carrier} ${f.number} ${f.origin}-${f.destination}`);
    if (!product.created) continue;
    const departure = new Date(utcDay(f.dep).getTime() + 9 * 3_600_000);
    await prisma.productFlight.create({
      data: {
        productId: product.id, carrier: f.carrier, flightNumber: f.number, origin: f.origin, destination: f.destination,
        departureAt: departure, arrivalAt: new Date(departure.getTime() + f.hours * 3_600_000),
      },
    });
    await prisma.availabilitySnapshot.create({ data: { productId: product.id, providerId: airline, stayDate: utcDay(f.dep), availableQuantity: 24 } });
    await prisma.rate.create({ data: { productId: product.id, currency: 'USD', amount: f.amount, taxesAmount: 85, validFrom: utcDay(0), validTo: utcDay(f.dep) } });
  }

  // Planes de asistencia al viajero.
  const plans = [
    { code: 'ASSIST-BASIC', name: 'Asistencia Basica', days: 15, coverage: 50_000, amount: 45 },
    { code: 'ASSIST-PLUS', name: 'Asistencia Plus', days: 30, coverage: 150_000, amount: 98 },
  ];
  for (const p of plans) {
    const product = await ensureProduct(assist, 'ASSISTANCE_PLAN', p.code, p.name);
    if (!product.created) continue;
    await prisma.productAssistance.create({
      data: { productId: product.id, planName: p.name, maxDays: p.days, medicalCoverageUsd: p.coverage, coverageSummary: 'Cobertura medica y de equipaje (datos de ejemplo)' },
    });
    await prisma.rate.create({ data: { productId: product.id, currency: 'USD', amount: p.amount, validFrom: utcDay(0), validTo: utcDay(364) } });
  }
}

async function main(): Promise<void> {
  console.log('Sembrando datos iniciales...');
  await seedRolesAndUsers();
  await seedCurrencies();
  const providers = await seedProviders();
  await seedCatalog(providers);
  console.log('Seed completado.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
