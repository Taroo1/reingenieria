/**
 * Entorno de las pruebas e2e: base de datos PROPIA (<db>_test, nunca la de desarrollo), simulador real
 * y limites de peticiones altos. Lee backend/.env sin dependencias externas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function testDatabaseUrl(devUrl: string): string {
  const u = new URL(devUrl);
  const db = u.pathname.replace(/^\//, '');
  if (!db) throw new Error('DATABASE_URL sin nombre de base');
  u.pathname = `/${db.endsWith('_test') ? db : `${db}_test`}`;
  return u.toString();
}

/** Aplica el entorno e2e a process.env (lo usan globalSetup y cada archivo de pruebas). */
export function applyE2eEnv(): Record<string, string> {
  const env = readDotEnv();
  const values: Record<string, string> = {
    ...env,
    DATABASE_URL: testDatabaseUrl(process.env.E2E_DATABASE_URL ?? env.DATABASE_URL),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'false',
    THROTTLE_LIMIT: '100000',
    LOGIN_THROTTLE_LIMIT: '100000',
    ALLOW_INSECURE_PROVIDER_URLS: 'true',
    // Los trabajos periodicos se invocan explicitamente en las pruebas (resultado determinista).
    JOBS_ENABLED: 'false',
    SIMULATOR_URL: process.env.SIMULATOR_URL ?? env.SIMULATOR_URL ?? 'http://localhost:4100',
  };
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  return values;
}
