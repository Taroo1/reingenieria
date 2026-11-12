import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { ISO_DATE } from '../../normalization/dto/canonical-query.dto';

export class QuoteItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '2026-12-01', description: 'Vuelo: fecha de salida. Habitacion: entrada. Plan: inicio del viaje.' }) @Matches(ISO_DATE) startDate!: string;
  @ApiPropertyOptional({ example: '2026-12-05', description: 'Habitacion: salida (obligatoria). Plan: fin del viaje. Vuelo: no aplica.' }) @IsOptional() @Matches(ISO_DATE) endDate?: string;
  @ApiProperty({ minimum: 1, maximum: 20 }) @IsInt() @Min(1) @Max(20) quantity!: number;
}

export class CreateQuoteDto {
  @ApiProperty({ example: 'USD', description: 'Moneda de la cotizacion; los items en otra moneda se convierten con exchange_rates' })
  @Matches(/^[A-Z]{3}$/) currency!: string;

  @ApiProperty({ type: [QuoteItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => QuoteItemDto)
  items!: QuoteItemDto[];
}

export class ListQuotesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'EXPIRED', 'CONVERTED'] }) @IsOptional() @IsIn(['OPEN', 'EXPIRED', 'CONVERTED']) status?: 'OPEN' | 'EXPIRED' | 'CONVERTED';
}
