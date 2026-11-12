import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  controllers: [HealthController, MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
