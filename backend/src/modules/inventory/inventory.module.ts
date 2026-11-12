import { Module } from '@nestjs/common';
import { AllotmentsService } from './allotments.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, AllotmentsService],
  exports: [InventoryService],
})
export class InventoryModule {}
