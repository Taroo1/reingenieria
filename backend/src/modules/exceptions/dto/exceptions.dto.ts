import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const EXCEPTION_TYPES = ['PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'NO_AVAILABILITY', 'PRICE_CHANGED', 'PARTIAL_CONFIRMATION', 'CANCELLATION_FAILED', 'RECONCILIATION_MISMATCH', 'MANUAL_PROVIDER', 'OTHER'] as const;
export const EXCEPTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'] as const;
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export class ListExceptionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: EXCEPTION_STATUSES }) @IsOptional() @IsIn(EXCEPTION_STATUSES) status?: (typeof EXCEPTION_STATUSES)[number];
  @ApiPropertyOptional({ enum: SEVERITIES }) @IsOptional() @IsIn(SEVERITIES) severity?: (typeof SEVERITIES)[number];
  @ApiPropertyOptional({ enum: EXCEPTION_TYPES }) @IsOptional() @IsIn(EXCEPTION_TYPES) type?: (typeof EXCEPTION_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() bookingId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToId?: string;
}

export class AssignExceptionDto {
  @ApiProperty({ nullable: true, description: 'Usuario responsable; null para desasignar' })
  @ValidateIf((_, v) => v !== null) @IsUUID() assignedToId!: string | null;
}

export class ExceptionNoteDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) message!: string;
}

export class CloseExceptionDto {
  @ApiProperty({ description: 'Que se hizo y por que' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) resolution!: string;
}
