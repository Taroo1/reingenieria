import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import type { AvailabilityQuery, ExternalRef, ProductKind, QueryBookingRequest, RateQuery } from '../canonical';

/** Formato YYYY-MM-DD (la validez calendario se comprueba en el servicio con isIsoDate). */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRODUCT_KINDS: ProductKind[] = ['FLIGHT', 'ROOM', 'ASSISTANCE_PLAN'];
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AvailabilityQueryDto implements AvailabilityQuery {
  @ApiProperty({ enum: PRODUCT_KINDS }) @IsIn(PRODUCT_KINDS)
  kind!: ProductKind;

  @ApiProperty({ example: '2026-12-01' }) @Matches(ISO_DATE, { message: 'startDate debe tener formato YYYY-MM-DD' })
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-12-05' }) @IsOptional() @Matches(ISO_DATE, { message: 'endDate debe tener formato YYYY-MM-DD' })
  endDate?: string;

  @ApiProperty({ minimum: 1, maximum: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(20)
  quantity!: number;

  @ApiPropertyOptional({ example: 'EZE' }) @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'origin debe ser un codigo IATA de 3 letras' })
  origin?: string;

  @ApiPropertyOptional({ example: 'PUJ' }) @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'destination debe ser un codigo IATA de 3 letras' })
  destination?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100)
  hotelExternalId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 40 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(40)
  adults?: number;
}

export class ExternalRefDto implements Pick<ExternalRef, 'externalId'> {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200)
  externalId!: string;
}

export class RateQueryDto implements Omit<RateQuery, 'products'> {
  @ApiProperty({ type: [ExternalRefDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ExternalRefDto)
  products!: ExternalRefDto[];

  @ApiProperty({ example: '2026-12-01' }) @Matches(ISO_DATE, { message: 'startDate debe tener formato YYYY-MM-DD' })
  startDate!: string;

  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE, { message: 'endDate debe tener formato YYYY-MM-DD' })
  endDate?: string;

  @ApiProperty({ minimum: 1, maximum: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(20)
  quantity!: number;
}

export class QueryBookingDto implements QueryBookingRequest {
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100)
  clientReference!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100)
  externalLocator?: string;
}
