import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';

export const PRODUCT_TYPES = ['FLIGHT', 'ROOM', 'ASSISTANCE_PLAN'] as const;

export class ListProductsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_TYPES }) @IsOptional() @IsIn(PRODUCT_TYPES) type?: (typeof PRODUCT_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(100) search?: string;
}
