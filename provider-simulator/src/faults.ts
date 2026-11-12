/**
 * Fallas inyectables por proveedor y ruta. Se configuran por la API de control y permiten reproducir
 * de forma determinista: latencia, errores 5xx, timeouts, respuestas mal formadas, resultados duplicados
 * y el caso critico "el proveedor ejecuto la operacion pero no respondio bien" (resultado desconocido).
 */
import { isRecord } from './util';

export const ROUTES = ['health', 'availability', 'rates', 'holds', 'bookings', 'cancel', 'query'] as const;
export type RouteName = (typeof ROUTES)[number];
export const WRITE_ROUTES: readonly RouteName[] = ['holds', 'bookings', 'cancel'];
const LIST_ROUTES: readonly RouteName[] = ['availability', 'rates', 'query'];

export const FAULT_TYPES = ['latency', 'error', 'timeout', 'malformed', 'duplicate', 'commit_then_error', 'commit_then_timeout'] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

export interface FaultRule {
  route: RouteName | '*';
  type: FaultType;
  /** Codigo HTTP para error / commit_then_error (por defecto 503). */
  status?: number;
  /** Demora adicional antes de procesar; para 'latency' es la demora principal. */
  latency_ms?: number;
  /** Cuantas veces se aplica; sin valor, se aplica siempre. */
  times?: number;
  /** Probabilidad 0..1 (por defecto 1). */
  probability?: number;
}

export class FaultValidationError extends Error {}

export function parseRules(input: unknown): FaultRule[] {
  if (!Array.isArray(input) || input.length > 50) throw new FaultValidationError('rules debe ser una lista de hasta 50 reglas');
  return input.map((r, i) => {
    if (!isRecord(r)) throw new FaultValidationError(`regla ${i}: objeto requerido`);
    const route = r.route ?? '*';
    if (route !== '*' && !ROUTES.includes(route as RouteName)) throw new FaultValidationError(`regla ${i}: route invalida`);
    if (!FAULT_TYPES.includes(r.type as FaultType)) throw new FaultValidationError(`regla ${i}: type invalido (${FAULT_TYPES.join(', ')})`);
    const type = r.type as FaultType;
    if ((type === 'commit_then_error' || type === 'commit_then_timeout') && route !== '*' && !WRITE_ROUTES.includes(route as RouteName)) {
      throw new FaultValidationError(`regla ${i}: ${type} solo aplica a holds, bookings o cancel`);
    }
    if (type === 'duplicate' && route !== '*' && !LIST_ROUTES.includes(route as RouteName)) {
      throw new FaultValidationError(`regla ${i}: duplicate solo aplica a availability, rates o query`);
    }
    const num = (v: unknown, name: string, min: number, max: number): number | undefined => {
      if (v === undefined) return undefined;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new FaultValidationError(`regla ${i}: ${name} fuera de rango [${min}, ${max}]`);
      return v;
    };
    const status = num(r.status, 'status', 400, 599);
    const times = num(r.times, 'times', 1, 10_000);
    return {
      route: route as RouteName | '*',
      type,
      status: status === undefined ? undefined : Math.trunc(status),
      latency_ms: num(r.latency_ms, 'latency_ms', 0, 120_000),
      times: times === undefined ? undefined : Math.trunc(times),
      probability: num(r.probability, 'probability', 0, 1),
    };
  });
}

function applies(rule: FaultRule, route: RouteName): boolean {
  if (rule.route !== '*' && rule.route !== route) return false;
  if ((rule.type === 'commit_then_error' || rule.type === 'commit_then_timeout') && !WRITE_ROUTES.includes(route)) return false;
  if (rule.type === 'duplicate' && !LIST_ROUTES.includes(route)) return false;
  return true;
}

export class FaultBook {
  private readonly rules = new Map<string, FaultRule[]>();

  set(provider: string, rules: FaultRule[]): void {
    if (rules.length === 0) this.rules.delete(provider);
    else this.rules.set(provider, rules.map((r) => ({ ...r })));
  }

  clear(): void {
    this.rules.clear();
  }

  snapshot(): Record<string, FaultRule[]> {
    return Object.fromEntries([...this.rules].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  }

  /** Devuelve la primera regla aplicable (primero las del proveedor, luego las globales '*') y consume una vez. */
  take(provider: string, route: RouteName, random: () => number = Math.random): FaultRule | null {
    for (const scope of [provider, '*']) {
      const list = this.rules.get(scope);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const rule = list[i];
        if (!applies(rule, route)) continue;
        if (rule.probability !== undefined && random() >= rule.probability) continue;
        if (rule.times !== undefined) {
          rule.times -= 1;
          if (rule.times <= 0) list.splice(i, 1);
          if (list.length === 0) this.rules.delete(scope);
        }
        return { ...rule };
      }
    }
    return null;
  }
}
