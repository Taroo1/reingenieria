import { Module } from '@nestjs/common';
import { IntegrationEngineModule } from '../integration-engine/integration-engine.module';
import { ExceptionsController } from './exceptions.controller';
import { ExceptionsService } from './exceptions.service';

@Module({
  imports: [IntegrationEngineModule],
  controllers: [ExceptionsController],
  providers: [ExceptionsService],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
