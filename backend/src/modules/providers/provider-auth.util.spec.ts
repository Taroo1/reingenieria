import { buildAuthHeaders, isValidHeaderName, missingCredentialFields } from './provider-auth.util';

describe('provider-auth.util', () => {
  it('API_KEY usa cabecera personalizada o X-API-Key', () => {
    expect(buildAuthHeaders('API_KEY', 'X-Custom', { apiKey: 'k' })).toEqual({ 'X-Custom': 'k' });
    expect(buildAuthHeaders('API_KEY', undefined, { apiKey: 'k' })).toEqual({ 'X-API-Key': 'k' });
  });
  it('BEARER y BASIC', () => {
    expect(buildAuthHeaders('BEARER', undefined, { token: 't' })).toEqual({ Authorization: 'Bearer t' });
    expect(buildAuthHeaders('BASIC', undefined, { username: 'u', password: 'p' })).toEqual({
      Authorization: 'Basic ' + Buffer.from('u:p').toString('base64'),
    });
  });
  it('NONE y OAUTH2 no generan cabeceras estaticas', () => {
    expect(buildAuthHeaders('NONE', undefined, null)).toEqual({});
    expect(buildAuthHeaders('OAUTH2_CLIENT', undefined, { clientId: 'a' })).toEqual({});
  });
  it('detecta campos faltantes', () => {
    expect(missingCredentialFields('BASIC', { username: 'u' })).toEqual(['password']);
    expect(missingCredentialFields('NONE', null)).toEqual([]);
    expect(missingCredentialFields('OAUTH2_CLIENT', {})).toEqual(['clientId', 'clientSecret', 'tokenUrl']);
  });
  it('valida nombres de cabecera', () => {
    expect(isValidHeaderName('X-Api-Key')).toBe(true);
    expect(isValidHeaderName('bad header\r\n')).toBe(false);
  });
});
