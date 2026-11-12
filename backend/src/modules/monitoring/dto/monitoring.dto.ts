import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

const KINDS = ['PROVIDER_DOWN', 'CIRCUIT_OPEN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY', 'SYNC_FAILED', 'INCONSISTENCY', 'EXCEPTION_OPENED'] as const;

export class ListAlertsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] }) @IsOptional() @IsIn(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']) status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @ApiPropertyOptional() @IsOptional() @IsUUID() integrationId?: string;
}
