import { addDaysIso, todayIso } from '../../../common/time/dates';
import { BoomiAdapter, BOOMI_NOT_CONNECTED } from '../boomi/boomi.adapter';
import { AdapterCallContext } from '../ports/provider-adapter.port';
import { SimulatedAdapter } from './simulated.adapter';

const ctx = (providerCode: string, providerType: string): AdapterCallContext => ({
  correlationId: 'c', transactionId: 't', attempt: 1,
  provider: {
    providerId: 'p', providerCode, providerType, baseUrl: '', authType: 'NONE', credentials: null, timeoutMs: 1000, maxRetries: 0,
    retryBaseMs: 10, retryMaxMs: 10, circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 1, halfOpenMaxCalls: 1 }, supportsIdempotency: false, params: {},
  },
});
const travelers = [{ firstName: 'Ana', lastName: 'Perez' }];

describe('SimulatedAdapter', () => {
  const day = addDaysIso(todayIso(), 10);

  it('busca vuelos con productos canonicos y cupo', async () => {
    const a = new SimulatedAdapter();
    const r = await a.searchAvailability({ kind: 'FLIGHT', startDate: day, quantity: 2, origin: 'EZE', destination: 'PUJ' }, ctx('SIM_AIRLINE', 'AIRLINE'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items).toHaveLength(1);
    expect(r.data.items[0]).toMatchObject({ availableQuantity: 24, source: 'PROVIDER_LIVE', product: { kind: 'FLIGHT', flightNumber: 'AR1304' } });
  });

  it('ciclo bloqueo -> confirmacion -> cancelacion con cupo y precio consistentes', async () => {
    const a = new SimulatedAdapter();
    const c = ctx('SIM_BEDBANK', 'BEDBANK');
    const product = { providerCode: 'SIM_BEDBANK', externalId: 'BB-ROOM-001' };
    const end = addDaysIso(day, 2);
    const rates = await a.getRates({ products: [product], startDate: day, endDate: end, quantity: 1 }, c);
    expect(rates.ok && rates.data.rates[0].total).toEqual({ amount: '308.00', currency: 'EUR' }); // 2 x 140 + 10%

    const hold = await a.hold({ clientReference: 'item-1', product, quantity: 5, startDate: day, endDate: end, travelers }, c);
    expect(hold.ok).toBe(true);
    const none = await a.hold({ clientReference: 'item-2', product, quantity: 1, startDate: day, endDate: end, travelers }, c);
    expect(none).toMatchObject({ ok: false, error: { code: 'NO_AVAILABILITY' } });

    const holdRef = hold.ok ? hold.data.providerHoldRef : '';
    const total = { amount: '1540.00', currency: 'EUR' };
    const wrong = await a.confirm({ clientReference: 'item-1', providerHoldRef: holdRef, product, quantity: 5, startDate: day, endDate: end, expectedTotal: { amount: '1.00', currency: 'EUR' }, travelers }, c);
    expect(wrong).toMatchObject({ ok: false, error: { code: 'PRICE_CHANGED' } });
    const ok1 = await a.confirm({ clientReference: 'item-1', providerHoldRef: holdRef, product, quantity: 5, startDate: day, endDate: end, expectedTotal: total, travelers }, c);
    expect(ok1).toMatchObject({ ok: true, data: { status: 'CONFIRMED' } });
    const again = await a.confirm({ clientReference: 'item-1', product, quantity: 5, startDate: day, endDate: end, expectedTotal: total, travelers }, c);
    expect(again.ok && ok1.ok && again.data.externalLocator).toBe(ok1.ok ? ok1.data.externalLocator : 'x'); // deduplica por clientReference

    const locator = ok1.ok ? ok1.data.externalLocator! : '';
    expect(await a.queryBooking({ clientReference: 'item-1' }, c)).toMatchObject({ ok: true, data: { found: true, status: 'CONFIRMED', externalLocator: locator } });
    expect(await a.cancel({ clientReference: 'item-1', externalLocator: locator }, c)).toMatchObject({ ok: true, data: { status: 'CANCELLED' } });
    const after = await a.hold({ clientReference: 'item-3', product, quantity: 5, startDate: day, endDate: end, travelers }, c);
    expect(after.ok).toBe(true); // el cupo volvio
  });

  it('rechaza productos inexistentes y datos invalidos', async () => {
    const a = new SimulatedAdapter();
    const c = ctx('SIM_ASSIST', 'TRAVEL_ASSISTANCE');
    expect(await a.hold({ clientReference: 'x', product: { providerCode: 'SIM_ASSIST', externalId: 'NOPE' }, quantity: 1, startDate: day, travelers }, c)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(await a.hold({ clientReference: 'x', product: { providerCode: 'SIM_ASSIST', externalId: 'ASSIST-BASIC' }, quantity: 1, startDate: day, endDate: addDaysIso(day, 20), travelers }, c)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('proveedor SIMULATED sin catalogo propio recibe un catalogo generico por tipo', async () => {
    const r = await new SimulatedAdapter().searchAvailability({ kind: 'ROOM', startDate: day, quantity: 1 }, ctx('NUEVO_HOTEL', 'HOTEL'));
    expect(r.ok && r.data.items.length).toBeGreaterThan(0);
  });
});

describe('BoomiAdapter', () => {
  it('todas las operaciones informan "sin conexion real", sin reintento y sin resultado incierto', async () => {
    const b = new BoomiAdapter();
    for (const r of [await b.healthCheck(), await b.searchAvailability(), await b.confirm(), await b.cancel(), await b.queryBooking()]) {
      expect(r).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: false, outcomeUnknown: false, providerCode: BOOMI_NOT_CONNECTED } });
    }
  });
});
