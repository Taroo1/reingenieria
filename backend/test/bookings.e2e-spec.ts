import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/common/database/prisma.service';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { bootApp, isoDay, login, simulator } from './helpers';

const API = '/api/v1';
let app: INestApplication;
let prisma: PrismaService;
let bookingsService: BookingsService;
let admin: string;
let viewer: string;
const integ: Record<string, string> = {};
const providers: Record<string, string> = {};

const api = () => request(app.getHttpServer());
const auth = (t = admin) => ({ Authorization: `Bearer ${t}` });
const key = () => `e2e-${randomUUID()}`;
const travelers = [{ firstName: 'Ana', lastName: 'Perez', email: 'ana@example.com', documentType: 'DNI', documentNumber: '30111222', isHolder: true }];

async function resolve(code: string) {
  const p = (await api().get(`${API}/providers?search=${code}`).set(auth()).expect(200)).body.data.find((x: { code: string }) => x.code === code);
  providers[code] = p.id;
  integ[code] = (await api().get(`${API}/integrations?providerId=${p.id}`).set(auth()).expect(200)).body.data[0].id;
}

async function configureHttp(code: string, simCode: string, supportsIdempotency: boolean) {
  await api().put(`${API}/providers/${providers[code]}/config`).set(auth()).send({
    baseUrl: `${simulator.url}/p/${simCode}`, authType: 'NONE', timeoutMs: 800, maxRetries: 1, retryBaseMs: 20, retryMaxMs: 50,
    cbFailureThreshold: 20, cbResetTimeoutMs: 1000, cbHalfOpenMaxCalls: 1, supportsIdempotency, params: { healthPath: '/health' },
  }).expect(200);
  await api().post(`${API}/integrations/${integ[code]}/enable`).set(auth()).expect(200);
  await api().post(`${API}/integrations/${integ[code]}/circuit/reset`).set(auth()).expect(200);
}

async function search(body: Record<string, unknown>) {
  return (await api().post(`${API}/search`).set(auth()).send(body).expect(200)).body.data as { offers: any[]; providers: any[] };
}
async function quote(currency: string, items: Array<Record<string, unknown>>) {
  return (await api().post(`${API}/quotes`).set(auth()).send({ currency, items }).expect(201)).body.data;
}
async function book(quoteId: string) {
  return (await api().post(`${API}/bookings`).set(auth()).set('Idempotency-Key', key()).send({ quoteId, holderName: 'Ana Perez', holderEmail: 'ana@example.com', travelers }).expect(201)).body.data;
}
const hold = async (id: string) => (await api().post(`${API}/bookings/${id}/hold`).set(auth()).set('Idempotency-Key', key()).expect(200)).body.data;
const confirm = async (id: string) => (await api().post(`${API}/bookings/${id}/confirm`).set(auth()).set('Idempotency-Key', key()).expect(200)).body.data;
const cancel = async (id: string) => (await api().post(`${API}/bookings/${id}/cancel`).set(auth()).set('Idempotency-Key', key()).send({ reason: 'Prueba e2e' }).expect(200)).body.data;

async function productId(code: string) {
  return (await prisma.product.findFirstOrThrow({ where: { code } })).id;
}
async function level(productIdValue: string, date: string) {
  return prisma.inventoryLevel.findUniqueOrThrow({ where: { productId_stayDate: { productId: productIdValue, stayDate: new Date(`${date}T00:00:00Z`) } } });
}

beforeAll(async () => {
  app = await bootApp();
  prisma = app.get(PrismaService);
  bookingsService = app.get(BookingsService);
  admin = await login(app, 'ADMIN');
  viewer = await login(app, 'VIEWER');
  for (const c of ['SIM_HTTP', 'HTTP_BEDBANK', 'OWN_HOTEL', 'SIM_BEDBANK']) await resolve(c);
  await configureHttp('SIM_HTTP', 'SKYJET', false);
  await configureHttp('HTTP_BEDBANK', 'BEDSPLUS', true);
});

afterAll(async () => {
  await simulator.reset();
  await app.close();
});

beforeEach(async () => {
  await simulator.reset();
});

describe('cupo propio (ALLOTMENT): busqueda -> cotizacion -> bloqueo -> confirmacion -> cancelacion', () => {
  it('dentro del plazo de release (7 dias en el seed) el cupo no se vende', async () => {
    const found = await search({ kind: 'ROOM', startDate: isoDay(3), endDate: isoDay(4), quantity: 1 });
    expect(found.offers.filter((o) => o.source === 'ALLOTMENT')).toHaveLength(0);
  });

  it('recorre el flujo completo moviendo el inventario de forma consistente', async () => {
    const [start, end] = [isoDay(9), isoDay(12)];
    const found = await search({ kind: 'ROOM', startDate: start, endDate: end, quantity: 1 });
    const offer = found.offers.find((o) => o.source === 'ALLOTMENT' && o.name.startsWith('Gran Caribe Resort - DOUBLE'));
    expect(offer).toBeDefined();
    expect(offer.price).toEqual({ total: '594.00', taxes: '54.00', currency: 'USD' }); // 3 noches x (180 + 18)
    expect(found.providers.some((p) => p.code === 'SIM_BEDBANK' && p.source === 'PROVIDER_LIVE' && p.ok)).toBe(true);

    const pid = offer.productId;
    const before = await Promise.all([start, isoDay(10), isoDay(11)].map((d) => level(pid, d)));
    const q = await quote('USD', [{ productId: pid, startDate: start, endDate: end, quantity: 1 }]);
    expect(q).toMatchObject({ status: 'OPEN', currency: 'USD', totalAmount: '594.00' });

    const b = await book(q.id);
    expect(b.status).toBe('QUOTED');
    const h = await hold(b.id);
    expect(h.outcome).toEqual({ status: 'HELD', errors: [] });
    for (const [i, d] of [start, isoDay(10), isoDay(11)].entries()) expect((await level(pid, d)).heldQuantity).toBe(before[i].heldQuantity + 1);

    const c = await confirm(b.id);
    expect(c.outcome.status).toBe('CONFIRMED');
    expect(c.booking.items[0].externalLocator).toMatch(/^SIM-/); // confirmado con el hotel por su integracion
    for (const [i, d] of [start, isoDay(10), isoDay(11)].entries()) {
      const l = await level(pid, d);
      expect(l.heldQuantity).toBe(before[i].heldQuantity);
      expect(l.soldQuantity).toBe(before[i].soldQuantity + 1);
    }

    const x = await cancel(b.id);
    expect(x.outcome.status).toBe('CANCELLED');
    for (const [i, d] of [start, isoDay(10), isoDay(11)].entries()) expect((await level(pid, d)).soldQuantity).toBe(before[i].soldQuantity);
    const kinds = (await prisma.inventoryMovement.findMany({ where: { referenceId: b.items[0].id }, orderBy: { at: 'asc' } })).map((m) => m.kind);
    expect(kinds.filter((k) => k === 'HOLD')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'CONFIRM')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'CANCEL')).toHaveLength(3);
    expect(x.booking.history.map((s: { to: string }) => s.to)).toEqual(['QUOTED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCEL_REQUESTED', 'CANCELLED']);
    expect(x.booking.travelers[0].documentNumber).toBe('*****222');
  });

  it('el bloqueo vencido expira la reserva y libera el cupo; confirmar despues da 409', async () => {
    const pid = await productId('ROOM-PLAYA-DOUBLE');
    const [start, end] = [isoDay(20), isoDay(21)];
    const before = await level(pid, start);
    const b = await book((await quote('USD', [{ productId: pid, startDate: start, endDate: end, quantity: 2 }])).id);
    await hold(b.id);
    expect((await level(pid, start)).heldQuantity).toBe(before.heldQuantity + 2);
    await prisma.bookingItem.updateMany({ where: { bookingId: b.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const r = await api().post(`${API}/bookings/${b.id}/confirm`).set(auth()).set('Idempotency-Key', key()).expect(409);
    expect(r.body.error.code).toBe('HOLD_EXPIRED');
    expect((await api().get(`${API}/bookings/${b.id}`).set(auth()).expect(200)).body.data.status).toBe('EXPIRED');
    expect((await level(pid, start)).heldQuantity).toBe(before.heldQuantity);
  });

  it('CONCURRENCIA: N bloqueos simultaneos sobre un cupo de K -> exactamente K, sin sobreventa', async () => {
    const pid = await productId('ROOM-PLAYA-FAMILY');
    const [start, end] = [isoDay(40), isoDay(42)]; // 2 noches
    const nights = [isoDay(40), isoDay(41)];
    const initial = await Promise.all(nights.map((d) => level(pid, d)));
    const K = Math.min(...initial.map((l) => l.totalQuantity - l.heldQuantity - l.soldQuantity));
    expect(K).toBeGreaterThan(0);
    const N = K + 6;
    const bookings = [];
    for (let i = 0; i < N; i++) bookings.push(await book((await quote('USD', [{ productId: pid, startDate: start, endDate: end, quantity: 1 }])).id));

    const results = await Promise.all(bookings.map((b) => api().post(`${API}/bookings/${b.id}/hold`).set(auth()).set('Idempotency-Key', key())));
    const statuses = results.map((r) => r.body.data?.outcome?.status);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(statuses.filter((s) => s === 'HELD')).toHaveLength(K);
    expect(statuses.filter((s) => s === 'FAILED')).toHaveLength(N - K);
    expect(results.filter((r) => r.body.data.outcome.status === 'FAILED').every((r) => r.body.data.outcome.errors[0].code === 'NO_AVAILABILITY')).toBe(true);

    for (const [i, d] of nights.entries()) {
      const l = await level(pid, d);
      expect(l.heldQuantity).toBe(initial[i].heldQuantity + K);
      expect(l.heldQuantity + l.soldQuantity).toBeLessThanOrEqual(l.totalQuantity);
      const holdMoves = await prisma.inventoryMovement.count({ where: { levelId: l.id, kind: 'HOLD', referenceId: { in: bookings.flatMap((b) => b.items.map((it: { id: string }) => it.id)) } } });
      expect(holdMoves).toBe(K);
    }

    // Limpieza: vencen los bloqueos y el cupo vuelve a su valor inicial.
    await prisma.bookingItem.updateMany({ where: { bookingId: { in: bookings.map((b) => b.id) } }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await bookingsService.expireDue();
    expect(expired.expiredHeld).toBe(K);
    for (const [i, d] of nights.entries()) expect((await level(pid, d)).heldQuantity).toBe(initial[i].heldQuantity);
  });
});

describe('proveedores en vivo (PROVIDER_LIVE)', () => {
  it('bedbank HTTP en EUR cotizado en USD: revalida y confirma; el precio de origen queda guardado', async () => {
    const [start, end] = [isoDay(15), isoDay(17)];
    const found = await search({ kind: 'ROOM', startDate: start, endDate: end, quantity: 1, providerIds: [providers.HTTP_BEDBANK] });
    const offer = found.offers.find((o) => o.provider.code === 'HTTP_BEDBANK' && o.product.hotel.name === 'Hotel Gran Via Centro' && o.product.roomType === 'DOUBLE');
    expect(offer.price).toEqual({ total: '297.00', taxes: '27.00', currency: 'EUR' }); // 2 x 135 + 10%

    const q = await quote('USD', [{ productId: offer.productId, startDate: start, endDate: end, quantity: 1 }]);
    expect(q.totalAmount).toBe('322.83'); // 297.00 EUR x 1.08695652 (ficticio)
    expect(q.items[0].source).toEqual({ currency: 'EUR', amount: '297.00' });

    const b = await book(q.id);
    expect((await hold(b.id)).outcome.status).toBe('HELD'); // sin bloqueo previo: solo revalida
    const c = await confirm(b.id);
    expect(c.outcome.status).toBe('CONFIRMED');
    expect(c.booking.items[0].externalLocator).toMatch(/^BED-/);
    expect((await simulator.stats('BEDSPLUS')).bookings_active).toBe(1);
    const tx = (await api().get(`${API}/bookings/${b.id}/transactions`).set(auth()).expect(200)).body.data.map((t: { operation: string }) => t.operation);
    expect(tx).toEqual(expect.arrayContaining(['SEARCH', 'GET_RATES', 'CONFIRM']));
  });

  it('vuelo con bloqueo en el proveedor: HOLD y luego CONFIRM con la referencia del bloqueo', async () => {
    const day = isoDay(10);
    const found = await search({ kind: 'FLIGHT', startDate: day, quantity: 1, origin: 'EZE', destination: 'PUJ', providerIds: [providers.SIM_HTTP] });
    const offer = found.offers[0];
    expect(offer).toMatchObject({ source: 'PROVIDER_LIVE', price: { total: '625.00', currency: 'USD' } });
    const b = await book((await quote('USD', [{ productId: offer.productId, startDate: day, quantity: 1 }])).id);
    const h = await hold(b.id);
    expect(h.booking.items[0].providerHoldRef).toMatch(/^H-/);
    const c = await confirm(b.id);
    expect(c.outcome.status).toBe('CONFIRMED');
    const stats = await simulator.stats('SKYJET');
    expect(stats.holds_active).toBe(0); // el bloqueo se consumio
    expect(stats.bookings_active).toBe(1);
  });

  it('cambio de precio antes de confirmar: no se confirma a otro precio', async () => {
    const [start, end] = [isoDay(15), isoDay(16)];
    const found = await search({ kind: 'ROOM', startDate: start, endDate: end, quantity: 1, providerIds: [providers.HTTP_BEDBANK] });
    const offer = found.offers.find((o) => o.product.roomType === 'SINGLE');
    const b = await book((await quote('EUR', [{ productId: offer.productId, startDate: start, endDate: end, quantity: 1 }])).id);
    await hold(b.id);
    await simulator.control('POST', 'price', { provider: 'BEDSPLUS', sku: offer.product.ref.externalId, unit_amount: '150.00' });
    const c = await confirm(b.id);
    expect(c.outcome).toMatchObject({ status: 'FAILED', errors: [expect.objectContaining({ code: 'PRICE_CHANGED' })] });
    expect((await simulator.stats('BEDSPLUS')).bookings_total).toBe(0);
    const ex = (await api().get(`${API}/exceptions?bookingId=${b.id}`).set(auth()).expect(200)).body.data;
    expect(ex[0]).toMatchObject({ type: 'PRICE_CHANGED', status: 'OPEN' });
  });
});

describe('resultado desconocido y conciliacion', () => {
  async function heldFlight(day: string) {
    const offer = (await search({ kind: 'FLIGHT', startDate: day, quantity: 1, origin: 'EZE', destination: 'CUN', providerIds: [providers.SIM_HTTP] })).offers[0];
    const b = await book((await quote('USD', [{ productId: offer.productId, startDate: day, quantity: 1 }])).id);
    await hold(b.id);
    return b;
  }

  it('timeout al confirmar pero el proveedor SI confirmo: se concilia al instante y queda CONFIRMED (sin duplicar)', async () => {
    const b = await heldFlight(isoDay(11));
    await simulator.faults('SKYJET', [{ route: 'bookings', type: 'commit_then_timeout', times: 1 }]);
    const c = await confirm(b.id);
    expect(c.outcome.status).toBe('CONFIRMED');
    expect(c.booking.items[0].externalLocator).toMatch(/^SKY-/);
    const ops = (await api().get(`${API}/bookings/${b.id}/transactions`).set(auth()).expect(200)).body.data.map((t: { operation: string; status: string }) => `${t.operation}:${t.status}`);
    expect(ops).toEqual(expect.arrayContaining(['CONFIRM:TIMEOUT', 'QUERY_BOOKING:SUCCESS']));
    const stats = await simulator.stats('SKYJET');
    expect(stats.requests.bookings).toBe(1); // nunca se reenvio la confirmacion
    expect(stats.bookings_total).toBe(1);
  });

  it('timeout y el proveedor NO confirmo: queda PENDING (nunca CONFIRMED), con excepcion; la conciliacion lo resuelve', async () => {
    const b = await heldFlight(isoDay(12));
    await simulator.faults('SKYJET', [{ route: 'bookings', type: 'timeout', times: 1 }]);
    const c = await confirm(b.id);
    expect(c.booking.status).toBe('PENDING_CONFIRMATION');
    expect(c.booking.items[0].status).toBe('PENDING_CONFIRMATION');
    expect(c.booking.exceptions).toEqual([expect.objectContaining({ type: 'PROVIDER_TIMEOUT', status: 'OPEN' })]);

    // Conciliar antes del plazo: el proveedor no la conoce, se sigue esperando.
    await bookingsService.reconcileItem(b.items[0].id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('PENDING_CONFIRMATION');

    // Pasado el plazo sin que el proveedor la registre: se da por no ejecutada.
    await prisma.$executeRaw`UPDATE booking_items SET updated_at = now() - interval '11 minutes' WHERE id = ${b.items[0].id}::uuid`;
    await bookingsService.reconcileItem(b.items[0].id);
    const after = (await api().get(`${API}/bookings/${b.id}`).set(auth()).expect(200)).body.data;
    expect(after.status).toBe('FAILED');
    expect(after.items[0].status).toBe('FAILED');
    expect((await simulator.stats('SKYJET')).bookings_total).toBe(0);
  });

  it('confirmacion a pedido (PENDING del proveedor): se concilia cuando el proveedor confirma', async () => {
    await resolve('HTTP_HOTEL');
    await configureHttp('HTTP_HOTEL', 'HOTELNET', true);
    const [start, end] = [isoDay(18), isoDay(19)];
    const offer = (await search({ kind: 'ROOM', startDate: start, endDate: end, quantity: 1, providerIds: [providers.HTTP_HOTEL] })).offers.find((o) => o.product.roomType === 'DOUBLE');
    const b = await book((await quote('USD', [{ productId: offer.productId, startDate: start, endDate: end, quantity: 1 }])).id);
    await hold(b.id);
    const c = await confirm(b.id);
    expect(c.booking.status).toBe('PENDING_CONFIRMATION');
    expect(c.booking.items[0].externalLocator).toMatch(/^HOT-/);
    await new Promise((r) => setTimeout(r, 5500)); // HOTELNET confirma a los 5 s
    const r = (await api().post(`${API}/bookings/${b.id}/reconcile`).set(auth()).expect(200)).body.data;
    expect(r.status).toBe('CONFIRMED');
  });
});

describe('falla parcial con compensacion', () => {
  it('vuelo confirmado + habitacion que falla: se cancela el vuelo y la reserva termina FAILED', async () => {
    const day = isoDay(13);
    const flight = (await search({ kind: 'FLIGHT', startDate: day, quantity: 1, origin: 'EZE', destination: 'MIA', providerIds: [providers.SIM_HTTP] })).offers[0];
    const room = (await search({ kind: 'ROOM', startDate: day, endDate: isoDay(15), quantity: 1, providerIds: [providers.HTTP_BEDBANK] })).offers.find((o) => o.product.hotel.name === 'Albergo Trevi');
    const q = await quote('USD', [
      { productId: flight.productId, startDate: day, quantity: 1 },
      { productId: room.productId, startDate: day, endDate: isoDay(15), quantity: 1 },
    ]);
    const b = await book(q.id);
    expect((await hold(b.id)).outcome.status).toBe('HELD');
    await simulator.control('POST', 'inventory', { provider: 'BEDSPLUS', sku: room.product.ref.externalId, date: day, units: 0 });

    const c = await confirm(b.id);
    expect(c.outcome.status).toBe('FAILED');
    const items = c.booking.items;
    expect(items.find((i: { product: { id: string } }) => i.product.id === flight.productId).status).toBe('CANCELLED');
    expect(items.find((i: { product: { id: string } }) => i.product.id === room.productId).status).toBe('FAILED');
    expect(c.booking.history.map((h: { to: string }) => h.to)).toEqual(expect.arrayContaining(['COMPENSATING', 'FAILED']));
    const sky = await simulator.stats('SKYJET');
    expect(sky.bookings_total).toBe(1);
    expect(sky.bookings_active).toBe(0); // se compenso: cancelada en el proveedor
    expect(c.booking.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PARTIAL_CONFIRMATION' })]));
  });

  it('si la compensacion falla, la reserva queda REQUIRES_REVIEW con excepcion HIGH', async () => {
    const day = isoDay(14);
    const flight = (await search({ kind: 'FLIGHT', startDate: day, quantity: 1, origin: 'EZE', destination: 'MIA', providerIds: [providers.SIM_HTTP] })).offers[0];
    const room = (await search({ kind: 'ROOM', startDate: day, endDate: isoDay(15), quantity: 1, providerIds: [providers.HTTP_BEDBANK] })).offers.find((o) => o.product.hotel.name === 'Albergo Trevi');
    const b = await book((await quote('USD', [{ productId: flight.productId, startDate: day, quantity: 1 }, { productId: room.productId, startDate: day, endDate: isoDay(15), quantity: 1 }])).id);
    await hold(b.id);
    await simulator.control('POST', 'inventory', { provider: 'BEDSPLUS', sku: room.product.ref.externalId, date: day, units: 0 });
    await simulator.faults('SKYJET', [{ route: 'cancel', type: 'error', status: 503 }]);
    const c = await confirm(b.id);
    expect(c.booking.status).toBe('REQUIRES_REVIEW');
    expect(c.booking.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'CANCELLATION_FAILED', severity: 'HIGH' })]));
  });
});

describe('idempotencia, permisos y validaciones de las reservas', () => {
  it('confirmar dos veces con la misma clave no vuelve a llamar al proveedor; sin clave -> 400', async () => {
    const day = isoDay(16);
    const offer = (await search({ kind: 'FLIGHT', startDate: day, quantity: 1, origin: 'EZE', destination: 'PUJ', providerIds: [providers.SIM_HTTP] })).offers[0];
    const b = await book((await quote('USD', [{ productId: offer.productId, startDate: day, quantity: 1 }])).id);
    await hold(b.id);
    await api().post(`${API}/bookings/${b.id}/confirm`).set(auth()).expect(400);
    const k = key();
    const first = await api().post(`${API}/bookings/${b.id}/confirm`).set(auth()).set('Idempotency-Key', k).expect(200);
    const second = await api().post(`${API}/bookings/${b.id}/confirm`).set(auth()).set('Idempotency-Key', k).expect(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.outcome).toEqual(first.body.data.outcome);
    expect((await simulator.stats('SKYJET')).requests.bookings).toBe(1);
    // Otra clave: la reserva ya no esta HELD.
    const again = await api().post(`${API}/bookings/${b.id}/confirm`).set(auth()).set('Idempotency-Key', key()).expect(409);
    expect(again.body.error.code).toBe('INVALID_BOOKING_STATE');
  });

  it('una cotizacion se usa una sola vez; CONSULTA no puede reservar', async () => {
    const pid = await productId('ROOM-GRAN-FAMILY');
    const q = await quote('USD', [{ productId: pid, startDate: isoDay(30), endDate: isoDay(31), quantity: 1 }]);
    await api().post(`${API}/bookings`).set(auth(viewer)).set('Idempotency-Key', key()).send({ quoteId: q.id, holderName: 'X', holderEmail: 'x@example.com', travelers }).expect(403);
    await book(q.id);
    const dup = await api().post(`${API}/bookings`).set(auth()).set('Idempotency-Key', key()).send({ quoteId: q.id, holderName: 'X', holderEmail: 'x@example.com', travelers }).expect(409);
    expect(dup.body.error.code).toBe('QUOTE_ALREADY_USED');
  });

  it('valida estadias y monedas', async () => {
    const pid = await productId('ROOM-GRAN-FAMILY');
    const noEnd = await api().post(`${API}/quotes`).set(auth()).send({ currency: 'USD', items: [{ productId: pid, startDate: isoDay(30), quantity: 1 }] }).expect(400);
    expect(noEnd.body.error.code).toBe('INVALID_STAY');
    await api().post(`${API}/quotes`).set(auth()).send({ currency: 'JPY', items: [{ productId: pid, startDate: isoDay(30), endDate: isoDay(31), quantity: 1 }] }).expect(400);
    await api().post(`${API}/search`).set(auth()).send({ kind: 'ROOM', startDate: '2026-02-30', endDate: '2026-03-02', quantity: 1 }).expect(400);
  });
});

describe('sincronizacion, inconsistencias y monitoreo', () => {
  it('CATALOG y RATES de un bedbank HTTP: normaliza productos, guarda referencias y tarifas con historial', async () => {
    const cat = (await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'CATALOG', integrationId: integ.HTTP_BEDBANK }).expect(200)).body.data;
    expect(cat).toMatchObject({ kind: 'CATALOG', status: 'SUCCESS' });
    expect(cat.itemsProcessed).toBe(3); // 3 tipos de habitacion de BEDSPLUS
    const refs = await prisma.externalReference.count({ where: { providerId: providers.HTTP_BEDBANK, entityType: 'product' } });
    expect(refs).toBeGreaterThanOrEqual(3);

    const rates = (await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'RATES', integrationId: integ.HTTP_BEDBANK }).expect(200)).body.data;
    expect(rates).toMatchObject({ kind: 'RATES', status: 'SUCCESS' });
    expect(rates.itemsProcessed).toBeGreaterThanOrEqual(3);
    const rate = await prisma.rate.findFirst({ where: { product: { providerId: providers.HTTP_BEDBANK } }, include: { rateHistoryByRateId: true } });
    expect(rate?.currency).toBe('EUR');
    expect(rate?.rateHistoryByRateId.length).toBeGreaterThanOrEqual(1);

    const again = (await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'RATES', integrationId: integ.HTTP_BEDBANK }).expect(200)).body.data;
    expect(again.itemsChanged).toBe(0); // sin cambios en el proveedor, no hay cambios locales
  });

  it('BOOKINGS: una reserva cancelada del lado del proveedor genera inconsistencia y excepcion', async () => {
    const day = isoDay(17);
    const offer = (await search({ kind: 'FLIGHT', startDate: day, quantity: 1, origin: 'EZE', destination: 'PUJ', providerIds: [providers.SIM_HTTP] })).offers[0];
    const b = await book((await quote('USD', [{ productId: offer.productId, startDate: day, quantity: 1 }])).id);
    await hold(b.id);
    const c = await confirm(b.id);
    const item = c.booking.items[0];
    await fetch(`${simulator.url}/p/SKYJET/bookings/${item.externalLocator}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_ref: item.id }) });

    const run = (await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'BOOKINGS', integrationId: integ.SIM_HTTP }).expect(200)).body.data;
    expect(run.inconsistenciesFound).toBeGreaterThanOrEqual(1);
    const inc = (await api().get(`${API}/inconsistencies?kind=BOOKING_STATUS_MISMATCH&status=OPEN`).set(auth()).expect(200)).body.data;
    expect(inc.some((i: { bookingItemId: string }) => i.bookingItemId === item.id)).toBe(true);
    const ex = (await api().get(`${API}/exceptions?bookingId=${b.id}`).set(auth()).expect(200)).body.data;
    expect(ex).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'RECONCILIATION_MISMATCH', severity: 'HIGH' })]));

    // Cierre del caso por un operador
    const exId = ex.find((e: { type: string }) => e.type === 'RECONCILIATION_MISMATCH').id;
    await api().post(`${API}/exceptions/${exId}/resolve`).set(auth()).send({ resolution: 'Se reprogramo con el pasajero' }).expect(200);
    const incId = inc.find((i: { bookingItemId: string }) => i.bookingItemId === item.id).id;
    await api().post(`${API}/inconsistencies/${incId}/close`).set(auth()).send({ status: 'RESOLVED', notes: 'Atendido' }).expect(200);
  });

  it('AVAILABILITY del cupo propio: compara unidades fisicas, registra la diferencia por fecha y la resuelve sola', async () => {
    const pid = await productId('ROOM-GRAN-FAMILY');
    const date = isoDay(3); // dentro del plazo de release: no se vende, pero el cupo fisico existe
    const mismatches = (d: string) => prisma.inconsistency.findMany({ where: { kind: 'AVAILABILITY_MISMATCH', status: 'OPEN', productId: pid, expected: { path: ['date'], equals: d } } });

    await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'AVAILABILITY', integrationId: integ.OWN_HOTEL }).expect(200);
    expect(await mismatches(date)).toHaveLength(0); // sin falsos positivos por el plazo de release

    await api().post(`${API}/inventory/levels/adjust`).set(auth()).send({ productId: pid, date, delta: -1, reason: 'e2e: provocar diferencia con el hotel' }).expect(200);
    await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'AVAILABILITY', integrationId: integ.OWN_HOTEL }).expect(200);
    const open = await mismatches(date);
    expect(open).toHaveLength(1);
    expect(open[0].expected).toMatchObject({ date, available: 5 });
    expect(open[0].actual).toMatchObject({ date, available: 6 });

    await api().post(`${API}/inventory/levels/adjust`).set(auth()).send({ productId: pid, date, delta: 1, reason: 'e2e: corregir' }).expect(200);
    await api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'AVAILABILITY', integrationId: integ.OWN_HOTEL }).expect(200);
    expect(await mismatches(date)).toHaveLength(0);
    const resolved = await prisma.inconsistency.findUniqueOrThrow({ where: { id: open[0].id } });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('dos sincronizaciones simultaneas del mismo tipo: una corre y la otra recibe 409', async () => {
    await simulator.faults('BEDSPLUS', [{ route: 'availability', type: 'latency', latency_ms: 300 }]);
    const [a, b] = await Promise.all([
      api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'AVAILABILITY', integrationId: integ.HTTP_BEDBANK }),
      api().post(`${API}/sync/runs`).set(auth()).send({ kind: 'AVAILABILITY', integrationId: integ.HTTP_BEDBANK }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('SYNC_IN_PROGRESS');
  });

  it('monitoreo: tablero con tasa de exito y latencias por integracion; alertas consultables', async () => {
    await search({ kind: 'FLIGHT', startDate: isoDay(10), quantity: 1, providerIds: [providers.SIM_HTTP] });
    const o = (await api().get(`${API}/monitoring/overview`).set(auth(viewer)).expect(200)).body.data;
    const sky = o.integrations.find((i: { id: string }) => i.id === integ.SIM_HTTP);
    expect(sky.last24h.calls).toBeGreaterThan(0);
    expect(sky.last24h.successRate).toBeGreaterThan(0);
    expect(typeof sky.last24h.latencyMs.p95).toBe('number');
    expect(o.bookingsByStatus).toHaveProperty('CONFIRMED');
    await api().get(`${API}/alerts?status=OPEN`).set(auth(viewer)).expect(200);
  });
});
