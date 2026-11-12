import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IntegrationEngineModule } from '../integration-engine/integration-engine.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RatesModule } from '../rates/rates.module';
import { ExchangeRatesService } from './exchange-rates.service';
import { PricingService } from './pricing.service';

@Module({
  imports: [CatalogModule, InventoryModule, RatesModule, IntegrationEngineModule],
  providers: [PricingService, ExchangeRatesService],
  exports: [PricingService, ExchangeRatesService],
})
export class PricingModule {}
