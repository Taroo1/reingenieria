import { SimulatorServer } from './server';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return n;
}

async function main(): Promise<void> {
  const adminToken = process.env.SIMULATOR_ADMIN_TOKEN?.trim() || undefined;
  if (adminToken && adminToken.length < 24) throw new Error('SIMULATOR_ADMIN_TOKEN debe tener al menos 24 caracteres');
  const apiKey = process.env.SIMULATOR_API_KEY?.trim() || undefined;
  const port = intEnv('PORT', 4100);
  const log = (msg: string) => console.log(JSON.stringify({ time: new Date().toISOString(), service: 'provider-simulator', msg }));

  const sim = new SimulatorServer({
    adminToken,
    apiKey,
    holdTtlMs: intEnv('SIMULATOR_HOLD_TTL_SECONDS', 900) * 1000,
    hangMaxMs: intEnv('SIMULATOR_HANG_MAX_MS', 120_000),
    log,
  });
  const bound = await sim.listen(port);
  log(`escuchando en el puerto ${bound}; API de control ${adminToken ? 'habilitada' : 'DESHABILITADA (sin SIMULATOR_ADMIN_TOKEN)'}; API key ${apiKey ? 'requerida' : 'no requerida'}`);

  const shutdown = () => {
    log('deteniendo');
    void sim.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
