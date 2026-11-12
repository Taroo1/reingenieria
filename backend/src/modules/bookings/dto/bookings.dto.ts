import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { ISO_DATE } from '../../normalization/dto/canonical-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class TravelerDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) lastName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ example: 'DNI' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(20) documentType?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) documentNumber?: string;
  @ApiPropertyOptional({ example: '1990-05-20' }) @IsOptional() @Matches(ISO_DATE) birthDate?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isHolder?: boolean;
}

export class CreateBookingDto {
  @ApiProperty() @IsUUID() quoteId!: string;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) holderName!: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) holderEmail!: string;
  @ApiProperty({ type: [TravelerDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TravelerDto)
  travelers!: TravelerDto[];
}

export class CancelBookingDto {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export const BOOKING_STATUSES = ['DRAFT', 'QUOTED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'REQUIRES_REVIEW', 'COMPENSATING', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'EXPIRED'] as const;

export class ListBookingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES }) @IsOptional() @IsIn(BOOKING_STATUSES) status?: (typeof BOOKING_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) reference?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(254) holderEmail?: string;
}
