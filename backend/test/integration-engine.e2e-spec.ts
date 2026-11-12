import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/common/database/prisma.service';
import { IntegrationEngine } from '../src/modules/integration-engine/integration-engine.service';
import { bootApp, isoDay, login, simulator, sleep } from './helpers';

const API = '/api/v1';
const day = isoDay(10);
const compact = day.replace(/-/g, '');
const travelers = [{ firstName: 'Ana', lastName: 'Perez', documentType: 'DNI', documentNumber: '30111222' }];
const skyFlight = { providerCode: 'SIM_HTTP', externalId: `SJ1304-${compact}` };
const skyTotal = { amount: '625.00', currency: 'USD' }; // 540 + 85
const consFlight = { providerCode: 'HTTP_CONSOLIDATOR', externalId: `CM701-${compact}` };
const consTotal = { amount: '565.00', currency: 'USD' }; // 495 + 70

let app: INestApplication;
let prisma: PrismaService;
let engine: IntegrationEngine;
let admin: string;
let viewer: string;
const ids: Record<string, { providerId: string; integrationId: string }> = {};

const api = () => request(app.getHttpServer());
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function resolve(code: string) {
  const p = await api().get(`${API}/providers?search=${code}`).set(auth(admin)).expect(200);
  const provider = p.body.data.find((x: { code: string }) => x.code === code);
  const i = await api().get(`${API}/integrations?providerId=${provider.id}`).set(auth(admin)).expect(200);
  ids[code] = { providerId: provider.id, integrationId: i.body.data[0].id };
}

async function configure(code: string, simCode: string, supportsIdempotency: boolean) {
  await api().put(`${API}/providers/${ids[code].providerId}/config`).set(auth(admin)).send({
    baseUrl: `${simulator.url}/p/${simCode}`, authType: 'NONE', timeoutMs: 500, maxRetries: 2, retryBaseMs: 20, retryMaxMs: 80,
    cbFailureThreshold: 3, cbResetTimeoutMs: 1000, cbHalfOpenMaxCalls: 1, supportsIdempotency, params: { healthPath: '/health' },
  }).expect(200);
  await api().post(`${API}/integrations/${ids[code].integrationId}/enable`).set(auth(admin)).expect(200);
}

const search = (code: string, body: Record<string, unknown> = {}) =>
  api().post(`${API}/integrations/${ids[code].integrationId}/test-call`).set(auth(admin))
    .send({ operation: 'SEARCH', availability: { kind: 'FLIGHT', startDate: day, quantity: 1, ...body } });

const confirmReq = (clientReference: string, product = skyFlight, expectedTotal = skyTotal) => ({
  clientReference, product, quantity: 1, startDate: day, expectedTotal, travelers,
});

async function attemptsOf(transactionId: string) {
  const r = await api().get(`${API}/audit/transactions/${transactionId}`).set(auth(admin)).expect(200);
  return r.body.data as { status: string; attempts: Array<{ attemptNumber: number; status: string; backoffMs: number | null }>; correlationId: string; operationKey: string | null };
}

beforeAll(async () => {
  app = await bootApp();
  prisma = app.get(PrismaService);
  engine = app.get(IntegrationEngine);
  admin = await login(app, 'ADMIN');
  viewer = await login(app, 'VIEWER');
  for (const code of ['SIM_HTTP', 'HTTP_GDS', 'HTTP_CONSOLIDATOR', 'SIM_AIRLINE', 'BOOMI_PENDING']) await resolve(code);
  await configure('SIM_HTTP', 'SKYJET', false);
  await configure('HTTP_GDS', 'GLOBALGDS', true);
  await configure('HTTP_CONSOLIDATOR', 'CONSOLIDA', true);
});

afterAll(async () => {
  await simulator.reset();
  await app.close();
});

beforeEach(async () => {
  await simulator.reset();
  for (const code of ['SIM_HTTP', 'HTTP_GDS', 'HTTP_CONSOLIDATOR']) {
    await api().post(`${API}/integrations/${ids[code].integrationId}/circuit/reset`).set(auth(admin)).expect(200);
  }
});

describe('health-check por el motor', () => {
  it('HTTP contra el simulador real: HEALTHY y queda registrado como transaccion', async () => {
    const r = await api().post(`${API}/integrations/${ids.SIM_HTTP.integrationId}/health-check`).set(auth(admin)).expect(200);
    expect(r.body.data).toMatchObject({ status: 'HEALTHY', success: true, statusCode: 200 });
    const tx = await attemptsOf(r.body.data.transactionId);
    expect(tx.status).toBe('SUCCESS');
  });

  it('SIMULATED HEALTHY y BOOMI UNKNOWN (sin conexion real)', async () => {
    const s = await api().post(`${API}/integrations/${ids.SIM_AIRLINE.integrationId}/health-check`).set(auth(admin)).expect(200);
    expect(s.body.data.status).toBe('HEALTHY');
    const b = await api().post(`${API}/integrations/${ids.BOOMI_PENDING.integrationId}/health-check`).set(auth(admin)).expect(200);
    expect(b.body.data).toMatchObject({ status: 'UNKNOWN', success: false });
    expect(b.body.data.message).toMatch(/sin conexion real/);
  });

  it('proveedor caido: DOWN', async () => {
    await simulator.faults('SKYJET', [{ route: 'health', type: 'error', status: 503, times: 1 }]);
    const r = await api().post(`${API}/integrations/${ids.SIM_HTTP.integrationId}/health-check`).set(auth(admin)).expect(200);
    expect(r.body.data).toMatchObject({ status: 'DOWN', statusCode: 503 });
  });
});

describe('lecturas con resiliencia', () => {
  it('busqueda normalizada, con transactionId y el mismo correlationId de la peticion', async () => {
    const r = await search('SIM_HTTP', { origin: 'EZE', destination: 'PUJ' }).set('X-Correlation-Id', 'e2e-corr-0001').expect(200);
    expect(r.body.data.ok).toBe(true);
    expect(r.body.data.data.items).toEqual([
      expect.objectContaining({ date: day, source: 'PROVIDER_LIVE', product: expect.objectContaining({ kind: 'FLIGHT', flightNumber: 'SJ1304', ref: expect.objectContaining(skyFlight) }) }),
    ]);
    const tx = await attemptsOf(r.body.meta.transactionId);
    expect(tx).toMatchObject({ status: 'SUCCESS', correlationId: 'e2e-corr-0001' });
    expect(tx.attempts).toHaveLength(1);
  });

  it('5xx transitorio: reintenta con backoff y termina bien', async () => {
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'error', status: 502, times: 2 }]);
    const r = await search('SIM_HTTP').expect(200);
    expect(r.body.data).toMatchObject({ ok: true, attempts: 3 });
    const tx = await attemptsOf(r.body.meta.transactionId);
    expect(tx.attempts.map((a) => a.status)).toEqual(['FAILED', 'FAILED', 'SUCCESS']);
    expect(tx.attempts[0].backoffMs).toBeGreaterThanOrEqual(20);
    expect(tx.attempts[1].backoffMs).toBeGreaterThanOrEqual(40);
    expect((await simulator.stats('SKYJET')).requests.availability).toBe(3);
  });

  it('timeout en todos los intentos: TIMEOUT tras maxRetries + 1 intentos', async () => {
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'timeout', times: 3 }]);
    const t0 = Date.now();
    const r = await search('SIM_HTTP').expect(200);
    expect(r.body.data).toMatchObject({ ok: false, attempts: 3, error: { code: 'TIMEOUT', retryable: true } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    expect((await attemptsOf(r.body.meta.transactionId)).status).toBe('TIMEOUT');
  });

  it('respuesta mal formada: PROTOCOL_ERROR y reintento', async () => {
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'malformed', times: 1 }]);
    const r = await search('SIM_HTTP').expect(200);
    expect(r.body.data).toMatchObject({ ok: true, attempts: 2 });
    const tx = await attemptsOf(r.body.meta.transactionId);
    expect(tx.attempts[0]).toMatchObject({ status: 'FAILED' });
  });

  it('resultados duplicados del proveedor se deduplican al normalizar', async () => {
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'duplicate', times: 1 }]);
    const r = await search('SIM_HTTP', { destination: 'PUJ' }).expect(200);
    expect(r.body.data.data.items).toHaveLength(1);
  });

  it('la consola de pruebas exige ADMIN u OPERADOR', async () => {
    await api().post(`${API}/integrations/${ids.SIM_HTTP.integrationId}/test-call`).set(auth(viewer))
      .send({ operation: 'SEARCH', availability: { kind: 'FLIGHT', startDate: day, quantity: 1 } }).expect(403);
  });
});

describe('circuit breaker persistido', () => {
  it('abre tras fallas consecutivas, corta las llamadas, alerta, y cierra con una prueba exitosa', async () => {
    const { integrationId } = ids.SIM_HTTP;
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'error', status: 503 }]);
    for (let i = 0; i < 3; i++) expect((await search('SIM_HTTP').expect(200)).body.data.ok).toBe(false);

    const cb = await prisma.circuitBreakerState.findUniqueOrThrow({ where: { integrationId } });
    expect(cb.state).toBe('OPEN');
    const alerts = await prisma.alert.findMany({ where: { integrationId, kind: 'CIRCUIT_OPEN', status: 'OPEN' } });
    expect(alerts).toHaveLength(1);
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } })).status).toBe('DOWN');

    const before = (await simulator.stats('SKYJET')).requests.availability;
    const cut = await search('SIM_HTTP').expect(200);
    expect(cut.body.data).toMatchObject({ ok: false, attempts: 0, error: { engineCode: 'CIRCUIT_OPEN' } });
    expect((await attemptsOf(cut.body.meta.transactionId)).status).toBe('SHORT_CIRCUITED');
    expect((await simulator.stats('SKYJET')).requests.availability).toBe(before); // no se llamo al proveedor

    // Otra falla mientras esta abierto no duplica la alerta.
    await search('SIM_HTTP').expect(200);
    expect(await prisma.alert.count({ where: { integrationId, kind: 'CIRCUIT_OPEN', status: { in: ['OPEN', 'ACKNOWLEDGED'] } } })).toBe(1);

    await simulator.control('DELETE', 'faults');
    await sleep(1100); // cbResetTimeoutMs
    const trial = await search('SIM_HTTP').expect(200);
    expect(trial.body.data.ok).toBe(true);
    expect((await prisma.circuitBreakerState.findUniqueOrThrow({ where: { integrationId } })).state).toBe('CLOSED');
    expect(await prisma.alert.count({ where: { integrationId, kind: 'CIRCUIT_OPEN', status: 'RESOLVED' } })).toBeGreaterThanOrEqual(1);
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } })).status).toBe('HEALTHY');
  });

  it('una prueba fallida en HALF_OPEN vuelve a abrir el circuito', async () => {
    const { integrationId } = ids.SIM_HTTP;
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'error', status: 503 }]);
    for (let i = 0; i < 3; i++) await search('SIM_HTTP').expect(200);
    await sleep(1100);
    expect((await search('SIM_HTTP').expect(200)).body.data.ok).toBe(false);
    const cb = await prisma.circuitBreakerState.findUniqueOrThrow({ where: { integrationId } });
    expect(cb.state).toBe('OPEN');
    expect(cb.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('los rechazos de negocio (sin cupo) no abren el circuito', async () => {
    await simulator.control('POST', 'inventory', { provider: 'SKYJET', sku: skyFlight.externalId, date: day, units: 0 });
    for (let i = 0; i < 4; i++) {
      const r = await engine.hold(ids.SIM_HTTP.integrationId, { ...confirmReq(`soldout-${i}`) }, `e2e-soldout-${i}:HOLD`);
      expect(r).toMatchObject({ ok: false, error: { code: 'NO_AVAILABILITY' } });
    }
    expect((await prisma.circuitBreakerState.findUniqueOrThrow({ where: { integrationId: ids.SIM_HTTP.integrationId } })).state).toBe('CLOSED');
  });

  it('una escritura cortada por el circuito libera su operationKey', async () => {
    const { integrationId } = ids.SIM_HTTP;
    await simulator.faults('SKYJET', [{ route: 'availability', type: 'error', status: 503 }]);
    for (let i = 0; i < 3; i++) await search('SIM_HTTP').expect(200);
    const key = `e2e-cut-${Date.now()}:CONFIRM:1`;
    const cut = await engine.confirm(integrationId, confirmReq('cut-1'), key);
    expect(cut).toMatchObject({ ok: false, error: { engineCode: 'CIRCUIT_OPEN', outcomeUnknown: false } });
    expect((await simulator.stats('SKYJET')).requests.bookings ?? 0).toBe(0);

    await api().post(`${API}/integrations/${integrationId}/circuit/reset`).set(auth(admin)).expect(200);
    const ok = await engine.confirm(integrationId, confirmReq('cut-1'), key);
    expect(ok).toMatchObject({ ok: true, replayed: false, data: { status: 'CONFIRMED' } });
  });
});

describe('escrituras: resultado desconocido e idempotencia saliente', () => {
  it('timeout al confirmar (el proveedor SI confirmo): DESCONOCIDO, sin reintento a ciegas; la consulta permite conciliar', async () => {
    await simulator.faults('SKYJET', [{ route: 'bookings', type: 'commit_then_timeout', times: 1 }]);
    const r = await engine.confirm(ids.SIM_HTTP.integrationId, confirmReq('unknown-1'), `e2e-unknown-${Date.now()}:CONFIRM:1`);
    expect(r).toMatchObject({ ok: false, attempts: 1, error: { code: 'TIMEOUT', outcomeUnknown: true } });
    expect((await simulator.stats('SKYJET')).bookings_total).toBe(1); // SKYJET no deduplica: un reintento ciego duplicaria

    const q = await engine.queryBooking(ids.SIM_HTTP.integrationId, { clientReference: 'unknown-1' });
    expect(q).toMatchObject({ ok: true, data: { found: true, status: 'CONFIRMED' } });
    expect(q.ok && q.data.externalLocator).toMatch(/^SKY-/);
  });

  it('5xx despues de procesar, con Idempotency-Key soportada: reintenta con la MISMA clave y no duplica', async () => {
    await simulator.faults('CONSOLIDA', [{ route: 'bookings', type: 'commit_then_error', status: 503, times: 1 }]);
    const key = `e2e-idem-${Date.now()}:CONFIRM:1`;
    const r = await engine.confirm(ids.HTTP_CONSOLIDATOR.integrationId, confirmReq('idem-1', consFlight, consTotal), key);
    expect(r).toMatchObject({ ok: true, attempts: 2, data: { status: 'CONFIRMED' } });
    const stats = await simulator.stats('CONSOLIDA');
    expect(stats.requests.bookings).toBe(2);
    expect(stats.bookings_total).toBe(1); // CONSOLIDA no deduplica por client_ref: lo evito la Idempotency-Key
    const tx = await prisma.integrationTransaction.findUniqueOrThrow({ where: { id: r.transactionId! } });
    expect(tx.idempotencyKey).toMatch(/^mgt-[a-f0-9]{40}$/);
  });

  it('operationKey ya ejecutada con exito: se devuelve el resultado guardado sin llamar al proveedor', async () => {
    const key = `e2e-replay-${Date.now()}:CONFIRM:1`;
    const first = await engine.confirm(ids.SIM_HTTP.integrationId, confirmReq('replay-1'), key);
    const second = await engine.confirm(ids.SIM_HTTP.integrationId, confirmReq('replay-1'), key);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.data.externalLocator).toBe(first.data.externalLocator);
    expect((await simulator.stats('SKYJET')).requests.bookings).toBe(1);
  });

  it('misma operationKey en paralelo: el proveedor recibe UNA sola llamada', async () => {
    await simulator.faults('SKYJET', [{ route: 'bookings', type: 'latency', latency_ms: 300 }]);
    const key = `e2e-race-${Date.now()}:CONFIRM:1`;
    const results = await Promise.all(Array.from({ length: 6 }, () => engine.confirm(ids.SIM_HTTP.integrationId, confirmReq('race-1'), key)));
    expect((await simulator.stats('SKYJET')).requests.bookings).toBe(1);
    expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) {
      expect(r).toMatchObject({ error: { engineCode: 'OPERATION_IN_PROGRESS', outcomeUnknown: true } });
    }
    expect(await prisma.integrationTransaction.count({ where: { operationKey: key } })).toBe(1);
  });

  it('operationKey con resultado desconocido: no se reenvia, se informa la ejecucion previa', async () => {
    await simulator.faults('SKYJET', [{ route: 'bookings', type: 'commit_then_timeout', times: 1 }]);
    const key = `e2e-prev-${Date.now()}:CONFIRM:1`;
    await engine.confirm(ids.SIM_HTTP.integrationId, confirmReq('prev-1'), key);
    const again = await engine.confirm(ids.SIM_HTTP.integrationId, confirmReq('prev-1'), key);
    expect(again).toMatchObject({ ok: false, error: { engineCode: 'OPERATION_ALREADY_EXECUTED', code: 'TIMEOUT', outcomeUnknown: true } });
    expect((await simulator.stats('SKYJET')).requests.bookings).toBe(1);
  });

  it('integracion deshabilitada (Boomi): no se llama y no se registra transaccion', async () => {
    const r = await engine.search(ids.BOOMI_PENDING.integrationId, { kind: 'FLIGHT', startDate: day, quantity: 1 });
    expect(r).toMatchObject({ ok: false, transactionId: null, error: { engineCode: 'INTEGRATION_DISABLED' } });
    await api().post(`${API}/integrations/${ids.BOOMI_PENDING.integrationId}/enable`).set(auth(admin)).expect(409);
  });
});

describe('idempotencia de entrada (Idempotency-Key)', () => {
  const body = (code: string) => ({ code, name: `Proveedor ${code}`, type: 'HOTEL', description: 'creado por e2e' });

  it('repetir con la misma clave devuelve la misma respuesta sin crear de nuevo', async () => {
    const key = `e2e-prov-${Date.now()}`;
    const code = `E2E_IDEM_${Date.now() % 1_000_000}`;
    const a = await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send(body(code)).expect(201);
    const b = await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send(body(code)).expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await prisma.provider.count({ where: { code } })).toBe(1);
  });

  it('misma clave con otro cuerpo -> 422; clave invalida -> 400', async () => {
    const key = `e2e-reuse-${Date.now()}`;
    await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send(body(`E2E_R1_${Date.now() % 1_000_000}`)).expect(201);
    const r = await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send(body('E2E_OTRO')).expect(422);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', 'corta').send(body('E2E_X')).expect(400);
  });

  it('peticiones simultaneas con la misma clave: se crea una sola vez', async () => {
    const key = `e2e-par-${Date.now()}`;
    const code = `E2E_PAR_${Date.now() % 1_000_000}`;
    const res = await Promise.all(Array.from({ length: 5 }, () => api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send(body(code))));
    const statuses = res.map((r) => r.status).sort();
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.provider.count({ where: { code } })).toBe(1);
    const ids201 = new Set(res.filter((r) => r.status === 201).map((r) => r.body.data.id));
    expect(ids201.size).toBe(1);
  });

  it('un error de validacion tambien se repite igual (resultado determinista)', async () => {
    const key = `e2e-bad-${Date.now()}`;
    const a = await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send({ code: 'x' }).expect(400);
    const b = await api().post(`${API}/providers`).set(auth(admin)).set('Idempotency-Key', key).send({ code: 'x' }).expect(400);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.error.code).toBe(a.body.error.code);
  });
});
