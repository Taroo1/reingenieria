import { Module } from '@nestjs/common';
import { FetchHttpClient, HttpClient } from '../integrations/http-client';
import { AdapterRegistry } from './adapter.registry';
import { BoomiAdapter } from './boomi/boomi.adapter';
import { HttpProviderAdapter } from './http/http.adapter';
import { OAuth2TokenProvider } from './http/oauth2-token.provider';
import { SimulatedAdapter } from './simulated/simulated.adapter';

@Module({
  providers: [
    { provide: HttpClient, useClass: FetchHttpClient },
    OAuth2TokenProvider,
    SimulatedAdapter,
    HttpProviderAdapter,
    BoomiAdapter,
    AdapterRegistry,
  ],
  exports: [AdapterRegistry, HttpClient],
})
export class AdaptersModule {}
