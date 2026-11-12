import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PageQueryDto, toBooleanQuery } from '../../../common/dto/pagination.dto';
import { ISO_DATE } from '../../normalization/dto/canonical-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

export class CreateRateDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiPropertyOptional({ default: 'BAR' }) @IsOptional() @Transform(trim) @Matches(/^[A-Z0-9_-]{1,20}$/) rateCode?: string;
  @ApiProperty({ example: 'USD' }) @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty({ example: '180.00', description: 'Por noche (habitacion) o por unidad (vuelo, plan)' }) @Matches(AMOUNT, { message: 'amount debe ser un importe decimal ("180.00")' }) amount!: string;
  @ApiPropertyOptional({ example: '18.00' }) @IsOptional() @Matches(AMOUNT) taxesAmount?: string;
  @ApiProperty({ example: '2026-12-01' }) @Matches(ISO_DATE) validFrom!: string;
  @ApiProperty({ example: '2027-03-31' }) @Matches(ISO_DATE) validTo!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) providerRateRef?: string;
}

export class UpdateRateDto {
  @ApiPropertyOptional({ example: '190.00' }) @IsOptional() @Matches(AMOUNT) amount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(AMOUNT) taxesAmount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO_DATE) validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ description: 'Motivo del cambio (queda en el historial)' }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class ListRatesQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBooleanQuery) @IsBoolean() active?: boolean;
}
