import { createHash, randomBytes } from 'node:crypto';

/** Refresh token opaco de 384 bits. Al cliente se entrega el token; en la base solo su hash. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshExpiry(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
