import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { AvailabilityQueryDto } from '../../normalization/dto/canonical-query.dto';

export class SearchDto extends AvailabilityQueryDto {
  @ApiPropertyOptional({ type: [String], description: 'Limitar a estos proveedores (por defecto, todos los habilitados)' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true })
  providerIds?: string[];
}
