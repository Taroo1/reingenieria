import { Module } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { ProvidersModule } from '../providers/providers.module';
import { AlertsService } from './alerts.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { IntegrationEngine } from './integration-engine.service';

@Module({
  imports: [AdaptersModule, ProvidersModule],
  providers: [IntegrationEngine, CircuitBreakerService, AlertsService],
  exports: [IntegrationEngine, CircuitBreakerService, AlertsService],
})
export class IntegrationEngineModule {}
