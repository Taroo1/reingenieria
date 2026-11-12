import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { Errors } from '../../common/errors/app.exception';

/** Escala de la tasa (DECIMAL(18,8)): las conversiones se hacen en enteros, sin coma flotante. */
const RATE_SCALE = 100_000_000n;

/** Convierte una tasa decimal ("0.92000000") a entero escalado. */
export function rateToScaled(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(rate.trim());
  if (!m) throw new Error(`Tasa invalida: ${rate}`);
  return BigInt(m[1]) * RATE_SCALE + BigInt((m[2] ?? '').padEnd(8, '0'));
}

/** centavos * tasa, redondeo half-up a centavos. */
export function convertCents(cents: number, scaledRate: bigint): number {
  const prod = BigInt(cents) * scaledRate;
  const q = prod / RATE_SCALE;
  const r = prod % RATE_SCALE;
  return Number(r * 2n >= RATE_SCALE ? q + 1n : q);
}

/** cents / tasa (tasa inversa), redondeo half-up a centavos. */
export function convertCentsInverse(cents: number, scaledRate: bigint): number {
  const num = BigInt(cents) * RATE_SCALE;
  const q = num / scaledRate;
  const r = num % scaledRate;
  return Number(r * 2n >= scaledRate ? q + 1n : q);
}

export interface Conversion {
  cents: number;
  rate: string;
  rateAsOf: Date | null;
  direct: boolean;
}

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convierte usando la tasa vigente mas reciente (as_of <= at). Usa la tasa directa from->to o, si no hay,
   * la inversa to->from. Sin tasa no se inventa una: 422 FX_RATE_MISSING.
   */
  async convert(cents: number, from: string, to: string, at = new Date()): Promise<Conversion> {
    if (from === to) return { cents, rate: '1', rateAsOf: null, direct: true };
    const [direct, inverse] = await Promise.all([
      this.prisma.exchangeRate.findFirst({ where: { baseCurrency: from, quoteCurrency: to, asOf: { lte: at } }, orderBy: { asOf: 'desc' } }),
      this.prisma.exchangeRate.findFirst({ where: { baseCurrency: to, quoteCurrency: from, asOf: { lte: at } }, orderBy: { asOf: 'desc' } }),
    ]);
    const useDirect = direct && (!inverse || direct.asOf >= inverse.asOf);
    if (useDirect) {
      const rate = direct.rate.toFixed(8);
      return { cents: convertCents(cents, rateToScaled(rate)), rate, rateAsOf: direct.asOf, direct: true };
    }
    if (inverse) {
      const rate = inverse.rate.toFixed(8);
      return { cents: convertCentsInverse(cents, rateToScaled(rate)), rate, rateAsOf: inverse.asOf, direct: false };
    }
    throw Errors.unprocessable('FX_RATE_MISSING', `No hay tipo de cambio ${from}->${to} cargado`, { from, to });
  }
}
