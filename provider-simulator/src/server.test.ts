import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { FaultBook, parseRules } from './faults';
import { SimulatorServer } from './server';
import { addDays, compactDate, fmtDate, todayUtc } from './util';

const TOKEN = 'test-admin-token-0123456789abcdef';
let sim: SimulatorServer;
let base: string;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 3000) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}
const control = (method: string, path: string, body?: unknown) => call(method, `/__control/${path}`, body, { 'X-Simulator-Admin-Token': TOKEN });

const d10 = addDays(todayUtc(Date.now()), 10);
const sku = `SJ1304-${compactDate(d10)}`;
const order = { client_ref: 'srv-1', sku, units: 1, date_from: fmtDate(d10), passengers: [{ first_name: 'Ana', last_name: 'Perez' }] };

before(async () => {
  sim = new SimulatorServer({ adminToken: TOKEN, holdTtlMs: 60_000, hangMaxMs: 2_000 });
  const port = await sim.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});
after(() => sim.close());
beforeEach(async () => { await control('POST', 'reset'); });

describe('servidor del simulador', () => {
  it('expone salud global y por proveedor', async () => {
    assert.equal((await call('GET', '/health')).json.status, 'UP');
    assert.equal((await call('GET', '/p/SKYJET/health')).json.provider, 'SKYJET');
    assert.equal((await call('GET', '/p/NOPE/health')).status, 404);
  });

  it('busca disponibilidad en formato propio del proveedor', async () => {
    const r = await call('POST', '/p/SKYJET/availability', { product_type: 'flight', date_from: fmtDate(d10), origin: 'EZE', destination: 'PUJ' });
    assert.equal(r.status, 200);
    assert.equal(r.json.results.length, 1);
    assert.equal(r.json.results[0].flight.number, 'SJ1304');
  });

  it('la API de control exige el token', async () => {
    assert.equal((await call('POST', '/__control/reset')).status, 401);
    assert.equal((await call('POST', '/__control/reset', undefined, { 'X-Simulator-Admin-Token': 'otro' })).status, 401);
  });

  it('inyecta error 5xx un numero exacto de veces', async () => {
    await control('POST', 'faults', { provider: 'SKYJET', rules: [{ route: 'availability', type: 'error', status: 502, times: 2 }] });
    const q = { product_type: 'flight', date_from: fmtDate(d10) };
    assert.equal((await call('POST', '/p/SKYJET/availability', q)).status, 502);
    assert.equal((await call('POST', '/p/SKYJET/availability', q)).status, 502);
    assert.equal((await call('POST', '/p/SKYJET/availability', q)).status, 200);
  });

  it('timeout: no responde y el cliente se rinde', async () => {
    await control('POST', 'faults', { provider: 'SKYJET', rules: [{ route: 'health', type: 'timeout', times: 1 }] });
    await assert.rejects(call('GET', '/p/SKYJET/health', undefined, {}, 300));
  });

  it('respuesta mal formada', async () => {
    await control('POST', 'faults', { provider: 'SKYJET', rules: [{ route: 'availability', type: 'malformed', times: 1 }] });
    const r = await call('POST', '/p/SKYJET/availability', { product_type: 'flight', date_from: fmtDate(d10) });
    assert.equal(r.status, 200);
    assert.ok('raw' in r.json);
  });

  it('commit_then_error: la reserva existe aunque la respuesta sea 503', async () => {
    await control('POST', 'faults', { provider: 'SKYJET', rules: [{ route: 'bookings', type: 'commit_then_error', status: 503, times: 1 }] });
    assert.equal((await call('POST', '/p/SKYJET/bookings', order)).status, 503);
    const q = await call('GET', '/p/SKYJET/bookings?client_ref=srv-1');
    assert.equal(q.json.bookings.length, 1);
    assert.equal(q.json.bookings[0].status, 'CONFIRMED');
  });

  it('Idempotency-Key: el reintento devuelve el mismo resultado y no duplica', async () => {
    const h = { 'Idempotency-Key': 'key-0001' };
    await control('POST', 'faults', { provider: 'SKYJET', rules: [{ route: 'bookings', type: 'commit_then_error', times: 1 }] });
    assert.equal((await call('POST', '/p/SKYJET/bookings', order, h)).status, 503);
    const retry = await call('POST', '/p/SKYJET/bookings', order, h);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    const stats = (await control('GET', 'stats?provider=SKYJET')).json.stats.SKYJET;
    assert.equal(stats.bookings_total, 1);
    const other = await call('POST', '/p/SKYJET/bookings', { ...order, units: 2 }, h);
    assert.equal(other.status, 422);
  });

  it('duplicate: repite los resultados de listas', async () => {
    await control('POST', 'faults', { provider: 'SKYJET', rules: [{ route: 'availability', type: 'duplicate', times: 1 }] });
    const r = await call('POST', '/p/SKYJET/availability', { product_type: 'flight', date_from: fmtDate(d10), destination: 'PUJ' });
    assert.equal(r.json.results.length, 2);
    assert.deepEqual(r.json.results[0], r.json.results[1]);
  });

  it('control de inventario y precio', async () => {
    await control('POST', 'inventory', { provider: 'SKYJET', sku, date: fmtDate(d10), units: 0 });
    assert.equal((await call('POST', '/p/SKYJET/bookings', order)).json.error.code, 'SOLD_OUT');
    await control('POST', 'inventory', { provider: 'SKYJET', sku, date: fmtDate(d10), units: 5 });
    await control('POST', 'price', { provider: 'SKYJET', sku, unit_amount: '999.00' });
    const r = await call('POST', '/p/SKYJET/rates', { skus: [sku], date_from: fmtDate(d10), units: 1 });
    assert.equal(r.json.offers[0].amount.total, '1084.00');
  });

  it('exige X-API-Key cuando esta configurada', async () => {
    const secured = new SimulatorServer({ adminToken: TOKEN, apiKey: 'k-123', holdTtlMs: 1000, hangMaxMs: 500 });
    const port = await secured.listen(0, '127.0.0.1');
    try {
      const no = await fetch(`http://127.0.0.1:${port}/p/SKYJET/health`);
      assert.equal(no.status, 401);
      const yes = await fetch(`http://127.0.0.1:${port}/p/SKYJET/health`, { headers: { 'X-API-Key': 'k-123' } });
      assert.equal(yes.status, 200);
    } finally {
      await secured.close();
    }
  });
});

describe('reglas de fallas', () => {
  it('valida y consume times/probability', () => {
    assert.throws(() => parseRules([{ route: 'availability', type: 'commit_then_error' }]));
    assert.throws(() => parseRules([{ route: 'nope', type: 'error' }]));
    const book = new FaultBook();
    book.set('SKYJET', parseRules([{ route: 'rates', type: 'error', times: 1 }, { route: '*', type: 'latency', latency_ms: 5, probability: 0.5 }]));
    assert.equal(book.take('SKYJET', 'rates')?.type, 'error');
    assert.equal(book.take('SKYJET', 'rates', () => 0.9), null, 'probabilidad no alcanzada');
    assert.equal(book.take('SKYJET', 'rates', () => 0.1)?.type, 'latency');
  });
});
