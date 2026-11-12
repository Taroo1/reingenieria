import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ExceptionsModule } from '../exceptions/exceptions.module';
import { IntegrationEngineModule } from '../integration-engine/integration-engine.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [CatalogModule, InventoryModule, ExceptionsModule, IntegrationEngineModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
