import { ApiPropertyOptional } from '@nestjs/swagger';
import { IntegrationOperation, LogLevel, TransactionStatus } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

class DateRangeQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional() @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional() @IsISO8601()
  to?: string;
}

export class AuditLogQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ example: 'provider' }) @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @ApiPropertyOptional({ example: 'PROVIDER_CREATED' }) @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) correlationId?: string;
}

export class TransactionQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() integrationId?: string;
  @ApiPropertyOptional({ enum: TransactionStatus }) @IsOptional() @IsEnum(TransactionStatus) status?: TransactionStatus;
  @ApiPropertyOptional({ enum: IntegrationOperation }) @IsOptional() @IsEnum(IntegrationOperation) operation?: IntegrationOperation;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) correlationId?: string;
}

export class SystemLogQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: LogLevel }) @IsOptional() @IsEnum(LogLevel) level?: LogLevel;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) context?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) correlationId?: string;
}
