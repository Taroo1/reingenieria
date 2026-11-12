import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, NotEquals } from 'class-validator';
import { PageQueryDto, toBooleanQuery } from '../../../common/dto/pagination.dto';
import { ISO_DATE } from '../../normalization/dto/canonical-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAllotmentDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '2026-12-01' }) @Matches(ISO_DATE) validFrom!: string;
  @ApiProperty({ example: '2027-03-31' }) @Matches(ISO_DATE) validTo!: string;
  @ApiProperty({ description: 'Unidades por fecha', minimum: 1, maximum: 10000 }) @IsInt() @Min(1) @Max(10000) quantity!: number;
  @ApiPropertyOptional({ description: 'Dias antes de la fecha en que el cupo vuelve al hotel', default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(365) releaseDays?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) notes?: string;
}

export class ListAllotmentsQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBooleanQuery) @IsBoolean() active?: boolean;
}

export class LevelsQueryDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '2026-12-01' }) @Matches(ISO_DATE) from!: string;
  @ApiProperty({ example: '2026-12-31' }) @Matches(ISO_DATE) to!: string;
}

export class AdjustLevelDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '2026-12-10' }) @Matches(ISO_DATE) date!: string;
  @ApiProperty({ description: 'Variacion del total (positiva o negativa, distinta de 0)' }) @Type(() => Number) @IsInt() @NotEquals(0) @Min(-10000) @Max(10000) delta!: number;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class MovementsQueryDto extends PageQueryDto {}
