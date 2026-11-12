import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IntegrationEngineModule } from '../integration-engine/integration-engine.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [CatalogModule, InventoryModule, PricingModule, IntegrationEngineModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
