import { validateProviderUrl } from './provider-url.util';

describe('validateProviderUrl', () => {
  it('acepta https publico y quita la barra final', () => {
    expect(validateProviderUrl('https://api.proveedor.com/v1/', false)).toBe('https://api.proveedor.com/v1');
  });
  it('rechaza http en modo estricto', () => {
    expect(() => validateProviderUrl('http://api.proveedor.com', false)).toThrow();
  });
  it.each(['https://localhost', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.1', 'https://172.20.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://x.internal'])(
    'rechaza host interno %s',
    (u) => expect(() => validateProviderUrl(u, false)).toThrow(),
  );
  it('rechaza credenciales embebidas y URLs invalidas', () => {
    expect(() => validateProviderUrl('https://u:p@api.com', false)).toThrow();
    expect(() => validateProviderUrl('no-es-url', false)).toThrow();
  });
  it('permite http y localhost con allowInsecure', () => {
    expect(validateProviderUrl('http://localhost:4000', true)).toBe('http://localhost:4000');
  });
  it('rechaza protocolos distintos aun con allowInsecure', () => {
    expect(() => validateProviderUrl('ftp://x.com', true)).toThrow();
  });
});
