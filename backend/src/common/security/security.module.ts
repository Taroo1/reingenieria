import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Env } from '../config/env.validation';
import { PasswordHasher } from './password-hasher';

@Global()
@Module({
  providers: [
    PasswordHasher,
    {
      provide: CredentialsCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => CredentialsCipher.fromBase64(config.get('CREDENTIALS_ENCRYPTION_KEY')),
    },
  ],
  exports: [PasswordHasher, CredentialsCipher],
})
export class SecurityModule {}
