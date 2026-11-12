import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyE2eEnv } from './e2e-env';

// El entorno debe aplicarse antes de importar AppModule (ConfigModule y Prisma leen process.env).
export const E2E = applyE2eEnv();

export async function bootApp(): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export async function login(app: INestApplication, who: 'ADMIN' | 'OPERATOR' | 'VIEWER' = 'ADMIN'): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: E2E[`SEED_${who}_EMAIL`], password: E2E[`SEED_${who}_PASSWORD`] })
    .expect(200);
  return res.body.data.accessToken as string;
}

/** Cliente de la API de control del simulador. */
export const simulator = {
  url: E2E.SIMULATOR_URL,
  async control(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${E2E.SIMULATOR_URL}/__control/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Simulator-Admin-Token': E2E.SIMULATOR_ADMIN_TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`control ${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
    return json;
  },
  reset: () => simulator.control('POST', 'reset'),
  faults: (provider: string, rules: unknown[]) => simulator.control('POST', 'faults', { provider, rules }),
  stats: async (provider: string) => (await simulator.control('GET', `stats?provider=${provider}`)).stats[provider],
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isoDay(offsetDays: number): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
