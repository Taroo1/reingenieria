import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { applyE2eEnv } from './e2e-env';

/**
 * Prepara la base de pruebas de forma NO destructiva: aplica las migraciones pendientes (crea la base
 * *_test si no existe) y corre el seed, que es idempotente. Nunca borra datos: las pruebas usan claves y
 * codigos unicos por corrida, y el estado del simulador y de los circuitos se reinicia por su propia API.
 */
export default async function globalSetup(): Promise<void> {
  const env = applyE2eEnv();
  if (!env.DATABASE_URL.includes('_test')) throw new Error('Las pruebas e2e solo corren contra una base *_test');

  const run = (cmd: string) =>
    execSync(cmd, { cwd: join(__dirname, '..'), env: { ...process.env }, stdio: process.env.E2E_VERBOSE ? 'inherit' : 'pipe' });
  run('npx prisma migrate deploy');
  run('npx prisma db seed');

  const url = env.SIMULATOR_URL;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(`El simulador no responde en ${url} (${(e as Error).message}). Levantelo con: docker compose up -d provider-simulator`);
  }
  if (!env.SIMULATOR_ADMIN_TOKEN) throw new Error('Defina SIMULATOR_ADMIN_TOKEN en backend/.env para controlar las fallas del simulador');
}
