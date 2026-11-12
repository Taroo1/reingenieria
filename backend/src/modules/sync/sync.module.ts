import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ExceptionsModule } from '../exceptions/exceptions.module';
import { IntegrationEngineModule } from '../integration-engine/integration-engine.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RatesModule } from '../rates/rates.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [CatalogModule, InventoryModule, RatesModule, ExceptionsModule, IntegrationEngineModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
