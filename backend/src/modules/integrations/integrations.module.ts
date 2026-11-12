import { Module } from '@nestjs/common';
import { IntegrationEngineModule } from '../integration-engine/integration-engine.module';
import { ProvidersModule } from '../providers/providers.module';
import { ConnectivityService } from './connectivity.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [ProvidersModule, IntegrationEngineModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ConnectivityService],
  exports: [IntegrationsService, ConnectivityService],
})
export class IntegrationsModule {}
