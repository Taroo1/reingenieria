import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ENCRYPTION_KEY_BYTES } from '../config/env.validation';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Cifrado AES-256-GCM de credenciales de proveedores.
 * Formato: v1.<iv>.<tag>.<texto cifrado> (base64url). El parametro `aad` ata el texto cifrado a un
 * contexto (p. ej. el id del proveedor) para que no pueda copiarse a otra fila.
 */
export class CredentialsCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== ENCRYPTION_KEY_BYTES) {
      throw new Error(`La clave de cifrado debe tener ${ENCRYPTION_KEY_BYTES} bytes`);
    }
    this.key = key;
  }

  static fromBase64(base64Key: string): CredentialsCipher {
    return new CredentialsCipher(Buffer.from(base64Key, 'base64'));
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(token: string, aad: string): string {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Formato de credencial cifrada no reconocido');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    try {
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      // No se expone el motivo: clave incorrecta, dato alterado o contexto distinto.
      throw new Error('No se pudo descifrar la credencial');
    }
  }

  encryptJson(value: unknown, aad: string): string {
    return this.encrypt(JSON.stringify(value), aad);
  }

  decryptJson<T>(token: string, aad: string): T {
    return JSON.parse(this.decrypt(token, aad)) as T;
  }
}
