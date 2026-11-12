import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Hash de contrasenas con argon2id (parametros minimos recomendados por OWASP). */
@Injectable()
export class PasswordHasher {
  private static readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  private dummyHash?: Promise<string>;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, PasswordHasher.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Gasta el mismo tiempo que una verificacion real. Se usa cuando el usuario no existe para
   * que la respuesta no revele si el correo esta registrado.
   */
  async burn(plain: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalization');
    await this.verify(await this.dummyHash, plain);
  }
}
