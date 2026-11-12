import { isIP } from 'node:net';

export class ProviderUrlError extends Error {}

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

function isPrivateIPv4(host: string): boolean {
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  const [a, b] = p;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}

/**
 * Valida la URL base de un proveedor (mitigacion SSRF):
 *  - solo https (http unicamente con allowInsecure, para desarrollo local y el simulador);
 *  - sin credenciales embebidas ni fragmento;
 *  - sin hosts internos (localhost, redes privadas, metadatos cloud) salvo allowInsecure.
 * Devuelve la URL normalizada, sin barra final.
 */
export function validateProviderUrl(raw: string, allowInsecure: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderUrlError('La URL base no es valida');
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new ProviderUrlError('La URL base debe usar https');
  }
  if (url.username || url.password) throw new ProviderUrlError('La URL base no puede contener credenciales');
  if (url.hash) throw new ProviderUrlError('La URL base no puede contener fragmento');

  if (!allowInsecure) {
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const kind = isIP(host);
    if (
      BLOCKED_HOSTS.has(host) ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      (kind === 4 && isPrivateIPv4(host)) ||
      (kind === 6 && isPrivateIPv6(host))
    ) {
      throw new ProviderUrlError('La URL base apunta a una direccion interna no permitida');
    }
  }
  return url.toString().replace(/\/+$/, '');
}
