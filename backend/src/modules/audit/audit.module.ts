import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { SystemLogService } from './system-log.service';
import { TransactionsService } from './transactions.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, SystemLogService, TransactionsService],
  exports: [AuditService, SystemLogService, TransactionsService],
})
export class AuditModule {}
