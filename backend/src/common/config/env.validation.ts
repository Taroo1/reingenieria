import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['true', '1', 'yes'].includes(value.toLowerCase()) : value;
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @Transform(toInt) @IsInt() @Min(1) @Max(65535)
  PORT: number = 3001;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  @Transform(toBool) @IsBoolean()
  SWAGGER_ENABLED: boolean = true;

  @IsString() @IsNotEmpty()
  CORS_ORIGINS: string = 'http://localhost:3000';

  @Transform(toBool) @IsBoolean()
  TRUST_PROXY: boolean = false;

  @IsString() @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString() @MinLength(32, { message: 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres' })
  JWT_ACCESS_SECRET!: string;

  @IsString() @IsNotEmpty()
  JWT_ACCESS_TTL: string = '15m';

  @Transform(toInt) @IsInt() @Min(1) @Max(90)
  REFRESH_TOKEN_TTL_DAYS: number = 7;

  @IsString() @IsNotEmpty({ message: 'CREDENTIALS_ENCRYPTION_KEY es obligatoria (openssl rand -base64 32)' })
  CREDENTIALS_ENCRYPTION_KEY!: string;

  @Transform(toInt) @IsInt() @Min(1000)
  THROTTLE_TTL_MS: number = 60000;

  @Transform(toInt) @IsInt() @Min(1)
  THROTTLE_LIMIT: number = 120;

  @Transform(toInt) @IsInt() @Min(1)
  LOGIN_THROTTLE_LIMIT: number = 5;

  @Transform(toBool) @IsBoolean()
  ALLOW_INSECURE_PROVIDER_URLS: boolean = false;

  // --- Etapa 3: reservas y trabajos en segundo plano ---
  /** Planificador de trabajos (vencimientos, conciliacion, sincronizacion). false en pruebas. */
  @Transform(toBool) @IsBoolean()
  JOBS_ENABLED: boolean = true;

  @Transform(toInt) @IsInt() @Min(1) @Max(1440)
  HOLD_TTL_MINUTES: number = 15;

  @Transform(toInt) @IsInt() @Min(1) @Max(1440)
  QUOTE_TTL_MINUTES: number = 30;

  @Transform(toInt) @IsInt() @Min(5) @Max(3600)
  RECONCILE_INTERVAL_SECONDS: number = 30;

  @Transform(toInt) @IsInt() @Min(1) @Max(1440)
  SYNC_INTERVAL_MINUTES: number = 15;

  /** Dias hacia adelante que cubre la sincronizacion de disponibilidad y tarifas. */
  @Transform(toInt) @IsInt() @Min(1) @Max(60)
  SYNC_WINDOW_DAYS: number = 14;
}

/** Longitud exacta de la clave AES-256 una vez decodificada. */
export const ENCRYPTION_KEY_BYTES = 32;

export function validateEnv(config: Record<string, unknown>): Env {
  const env = plainToInstance(Env, config, { enableImplicitConversion: false });
  const errors = validateSync(env, { skipMissingProperties: false });
  const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));

  const key = Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY ?? '', 'base64');
  if (env.CREDENTIALS_ENCRYPTION_KEY && key.length !== ENCRYPTION_KEY_BYTES) {
    messages.push(`CREDENTIALS_ENCRYPTION_KEY debe ser base64 de ${ENCRYPTION_KEY_BYTES} bytes (openssl rand -base64 32)`);
  }

  // Los valores de ejemplo nunca son validos fuera de desarrollo/pruebas.
  const placeholders = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;
  for (const k of placeholders) {
    if (String(env[k] ?? '').includes('CHANGE_ME')) {
      messages.push(`${k} conserva el valor de ejemplo CHANGE_ME: genere uno propio (ver infrastructure/scripts/setup-env.sh)`);
    }
  }
  if (env.NODE_ENV === 'production' && env.ALLOW_INSECURE_PROVIDER_URLS) {
    messages.push('ALLOW_INSECURE_PROVIDER_URLS=true no esta permitido en produccion');
  }

  if (messages.length > 0) {
    throw new Error(`Configuracion de entorno invalida:\n - ${messages.join('\n - ')}`);
  }
  return env;
}
