import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { QuotesModule } from '../quotes/quotes.module';
import { SyncModule } from '../sync/sync.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [BookingsModule, QuotesModule, SyncModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
