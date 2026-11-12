import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findProduct, priceFor, PROVIDERS } from './catalog';
import { SimState } from './state';
import { addDays, compactDate, fmtDate, todayUtc } from './util';

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const day = (n: number) => addDays(todayUtc(NOW), n);
const pax = [{ first_name: 'Ana', last_name: 'Perez' }];

function setup(holdTtlMs = 60_000) {
  let now = NOW;
  const state = new SimState(holdTtlMs, () => now);
  return { state, advance: (ms: number) => { now += ms; } };
}

describe('catalogo y precios', () => {
  it('resuelve vuelos solo dentro del horizonte', () => {
    const p = PROVIDERS.SKYJET;
    assert.equal(findProduct(p, `SJ1304-${compactDate(day(10))}`, NOW)?.type, 'flight');
    assert.equal(findProduct(p, `SJ1304-${compactDate(day(-1))}`, NOW), null);
    assert.equal(findProduct(p, `SJ1304-${compactDate(day(400))}`, NOW), null);
    assert.equal(findProduct(p, 'XX999-20261120', NOW), null);
  });

  it('calcula vuelos, noches de hotel y planes en centavos', () => {
    const flight = findProduct(PROVIDERS.SKYJET, `SJ1304-${compactDate(day(10))}`, NOW)!;
    assert.deepEqual(priceFor(flight, day(10), null, 2), { totalCents: 2 * (54_000 + 8_500), taxCents: 17_000 });
    const room = findProduct(PROVIDERS.BEDSPLUS, 'BP-MAD01-DBL', NOW)!;
    // 3 noches x 135.00 x 1 = 405.00 + 10% = 445.50
    assert.deepEqual(priceFor(room, day(5), day(8), 1), { totalCents: 44_550, taxCents: 4_050 });
    const plan = findProduct(PROVIDERS.ASSISTPRO, 'AP-BASIC', NOW)!;
    assert.ok('error' in priceFor(plan, day(0), day(20), 1), 'Plan Basico cubre 15 dias');
  });
});

describe('estado del proveedor', () => {
  it('bloqueo descuenta cupo, la reserva lo consume y la cancelacion lo devuelve', () => {
    const { state } = setup();
    const rt = state.runtime('SKYJET')!;
    const sku = `SJ1304-${compactDate(day(10))}`;
    const product = findProduct(rt.def, sku, NOW)!;
    const order = { client_ref: 'item-1', sku, units: 2, date_from: fmtDate(day(10)), passengers: pax };

    const hold = state.createHold(rt, order);
    assert.equal(hold.status, 201);
    assert.equal(state.unitsLeft(rt, product, fmtDate(day(10))), 7);

    const holdId = (hold.body as { hold_id: string }).hold_id;
    const booking = state.createBooking(rt, { ...order, hold_id: holdId });
    assert.equal(booking.status, 201);
    assert.equal((booking.body as { status: string }).status, 'CONFIRMED');
    assert.equal(state.unitsLeft(rt, product, fmtDate(day(10))), 7, 'el bloqueo consumido no vuelve a descontar');

    const locator = (booking.body as { locator: string }).locator;
    const cancel = state.cancelBooking(rt, locator, { client_ref: 'item-1' });
    assert.equal((cancel.body as { status: string }).status, 'CANCELLED');
    assert.notEqual((cancel.body as { penalty: unknown }).penalty, null, 'tarifa no reembolsable: penalidad total');
    assert.equal(state.unitsLeft(rt, product, fmtDate(day(10))), 9);
  });

  it('el bloqueo vencido devuelve el cupo', () => {
    const { state, advance } = setup(1_000);
    const rt = state.runtime('SKYJET')!;
    const sku = `SJ1304-${compactDate(day(10))}`;
    const product = findProduct(rt.def, sku, NOW)!;
    state.createHold(rt, { client_ref: 'item-2', sku, units: 9, date_from: fmtDate(day(10)), passengers: pax });
    assert.equal(state.unitsLeft(rt, product, fmtDate(day(10))), 0);
    advance(1_500);
    state.sweep(rt);
    assert.equal(state.unitsLeft(rt, product, fmtDate(day(10))), 9);
  });

  it('rechaza sin cupo (SOLD_OUT) y con precio distinto al esperado (PRICE_MISMATCH)', () => {
    const { state } = setup();
    const rt = state.runtime('BEDSPLUS')!;
    const base = { sku: 'BP-MAD01-DBL', date_from: fmtDate(day(5)), date_to: fmtDate(day(6)), passengers: pax };
    assert.equal(state.createBooking(rt, { ...base, client_ref: 'a', units: 6 }).status, 409);
    const wrong = state.createBooking(rt, { ...base, client_ref: 'b', units: 1, expected_total: { amount: '1.00', currency: 'EUR' } });
    assert.equal(wrong.status, 409);
    assert.equal((wrong.body as { error: { code: string } }).error.code, 'PRICE_MISMATCH');
  });

  it('deduplica por client_ref solo si el proveedor lo hace', () => {
    const { state } = setup();
    const bp = state.runtime('BEDSPLUS')!;
    const order = { client_ref: 'dup-1', sku: 'BP-MAD01-DBL', units: 1, date_from: fmtDate(day(5)), date_to: fmtDate(day(6)), passengers: pax };
    const a = state.createBooking(bp, order);
    const b = state.createBooking(bp, order);
    assert.equal((a.body as { locator: string }).locator, (b.body as { locator: string }).locator);

    const sj = state.runtime('SKYJET')!;
    const sku = `SJ1306-${compactDate(day(12))}`;
    const o2 = { client_ref: 'dup-2', sku, units: 1, date_from: fmtDate(day(12)), passengers: pax };
    state.createBooking(sj, o2);
    state.createBooking(sj, o2);
    const q = state.queryBookings(sj, 'dup-2').body as { bookings: unknown[] };
    assert.equal(q.bookings.length, 2, 'SKYJET no deduplica: un reintento ciego duplica la reserva');
  });

  it('confirmacion a pedido: PENDING y luego CONFIRMED', () => {
    const { state, advance } = setup();
    const rt = state.runtime('HOTELNET')!;
    const r = state.createBooking(rt, { client_ref: 'h-1', sku: 'HN-CARIBE-DBL', units: 1, date_from: fmtDate(day(20)), date_to: fmtDate(day(23)), passengers: pax });
    assert.equal((r.body as { status: string }).status, 'PENDING');
    advance(6_000);
    const q = state.queryBookings(rt, 'h-1').body as { bookings: Array<{ status: string }> };
    assert.equal(q.bookings[0].status, 'CONFIRMED');
  });

  it('valida la entrada', () => {
    const { state } = setup();
    const rt = state.runtime('SKYJET')!;
    assert.equal(state.availability(rt, { product_type: 'flight', date_from: '2026-02-30' }).status, 400);
    assert.equal(state.availability(rt, { product_type: 'boat', date_from: fmtDate(day(1)) }).status, 400);
    assert.equal(state.createBooking(rt, { client_ref: 'x', sku: `SJ1304-${compactDate(day(3))}`, units: 1, date_from: fmtDate(day(3)), passengers: [] }).status, 400);
  });
});
