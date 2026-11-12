import { randomBytes } from 'node:crypto';
import { CredentialsCipher } from './credentials-cipher';

describe('CredentialsCipher', () => {
  const key = randomBytes(32);
  const cipher = new CredentialsCipher(key);

  it('cifra y descifra un objeto', () => {
    const secret = { apiKey: 'abc-123', password: 'p@ss' };
    const token = cipher.encryptJson(secret, 'provider:1');
    expect(token.startsWith('v1.')).toBe(true);
    expect(token).not.toContain('abc-123');
    expect(cipher.decryptJson(token, 'provider:1')).toEqual(secret);
  });

  it('produce textos cifrados distintos para el mismo dato (IV aleatorio)', () => {
    expect(cipher.encrypt('x', 'a')).not.toBe(cipher.encrypt('x', 'a'));
  });

  it('rechaza un contexto (aad) distinto', () => {
    const token = cipher.encrypt('secreto', 'provider:1');
    expect(() => cipher.decrypt(token, 'provider:2')).toThrow('No se pudo descifrar la credencial');
  });

  it('rechaza datos alterados', () => {
    const token = cipher.encrypt('secreto', 'provider:1');
    const parts = token.split('.');
    parts[3] = Buffer.from('otra-cosa').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'), 'provider:1')).toThrow('No se pudo descifrar la credencial');
  });

  it('rechaza otra clave', () => {
    const token = cipher.encrypt('secreto', 'provider:1');
    expect(() => new CredentialsCipher(randomBytes(32)).decrypt(token, 'provider:1')).toThrow();
  });

  it('rechaza un formato desconocido', () => {
    expect(() => cipher.decrypt('v9.a.b.c', 'x')).toThrow('Formato de credencial cifrada no reconocido');
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => new CredentialsCipher(randomBytes(16))).toThrow();
  });
});
