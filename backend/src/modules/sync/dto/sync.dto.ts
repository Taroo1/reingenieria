import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

export const SYNC_KINDS = ['CATALOG', 'AVAILABILITY', 'RATES', 'BOOKINGS'] as const;
export type SyncKindName = (typeof SYNC_KINDS)[number];

export class RunSyncDto {
  @ApiProperty({ enum: SYNC_KINDS }) @IsIn(SYNC_KINDS) kind!: SyncKindName;
  @ApiProperty() @IsUUID() integrationId!: string;
}

export class ListSyncRunsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SYNC_KINDS }) @IsOptional() @IsIn(SYNC_KINDS) kind?: SyncKindName;
  @ApiPropertyOptional() @IsOptional() @IsUUID() integrationId?: string;
  @ApiPropertyOptional({ enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] }) @IsOptional() @IsIn(['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']) status?: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

export class ListInconsistenciesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'RESOLVED', 'IGNORED'] }) @IsOptional() @IsIn(['OPEN', 'RESOLVED', 'IGNORED']) status?: 'OPEN' | 'RESOLVED' | 'IGNORED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional({ enum: ['AVAILABILITY_MISMATCH', 'RATE_MISMATCH', 'BOOKING_STATUS_MISMATCH', 'MISSING_AT_PROVIDER', 'MISSING_LOCAL'] })
  @IsOptional() @IsIn(['AVAILABILITY_MISMATCH', 'RATE_MISMATCH', 'BOOKING_STATUS_MISMATCH', 'MISSING_AT_PROVIDER', 'MISSING_LOCAL'])
  kind?: 'AVAILABILITY_MISMATCH' | 'RATE_MISMATCH' | 'BOOKING_STATUS_MISMATCH' | 'MISSING_AT_PROVIDER' | 'MISSING_LOCAL';
}

export class CloseInconsistencyDto {
  @ApiProperty({ enum: ['RESOLVED', 'IGNORED'] }) @IsIn(['RESOLVED', 'IGNORED']) status!: 'RESOLVED' | 'IGNORED';
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @IsNotEmpty() @MaxLength(1000) notes!: string;
}
