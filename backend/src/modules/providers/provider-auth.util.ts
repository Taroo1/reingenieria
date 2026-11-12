import type { AuthTypeName, ProviderCredentials } from '../adapters/ports/provider-adapter.port';

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export function isValidHeaderName(name: string): boolean {
  return HEADER_NAME.test(name);
}

/** Credenciales obligatorias segun el tipo de autenticacion. Devuelve los campos que faltan. */
export function missingCredentialFields(authType: AuthTypeName, c: ProviderCredentials | null | undefined): string[] {
  const has = (v?: string) => typeof v === 'string' && v.length > 0;
  const need: Array<keyof ProviderCredentials> =
    authType === 'API_KEY' ? ['apiKey']
    : authType === 'BEARER' ? ['token']
    : authType === 'BASIC' ? ['username', 'password']
    : authType === 'OAUTH2_CLIENT' ? ['clientId', 'clientSecret', 'tokenUrl']
    : [];
  return need.filter((f) => !has(c?.[f]));
}

/**
 * Cabeceras de autenticacion estaticas. OAUTH2_CLIENT devuelve vacio: el token se obtiene en runtime
 * contra tokenUrl (lo resuelve el adaptador HTTP en la Etapa 3).
 */
export function buildAuthHeaders(
  authType: AuthTypeName,
  authHeaderName: string | undefined,
  c: ProviderCredentials | null,
): Record<string, string> {
  switch (authType) {
    case 'API_KEY':
      return c?.apiKey ? { [authHeaderName || 'X-API-Key']: c.apiKey } : {};
    case 'BEARER':
      return c?.token ? { Authorization: `Bearer ${c.token}` } : {};
    case 'BASIC':
      return c?.username !== undefined && c?.password !== undefined
        ? { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`, 'utf8').toString('base64')}` }
        : {};
    default:
      return {};
  }
}
