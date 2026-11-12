import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { PageQueryDto, toBooleanQuery } from '../../../common/dto/pagination.dto';
import { AvailabilityQueryDto, QueryBookingDto, RateQueryDto } from '../../normalization/dto/canonical-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export enum AdapterKindDto { SIMULATED = 'SIMULATED', HTTP = 'HTTP', BOOMI = 'BOOMI' }

export class CreateIntegrationDto {
  @ApiProperty() @IsUUID() providerId!: string;
  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @ApiProperty({ enum: AdapterKindDto }) @IsEnum(AdapterKindDto) adapterKind!: AdapterKindDto;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
}

export class ListIntegrationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional({ enum: AdapterKindDto }) @IsOptional() @IsEnum(AdapterKindDto) adapterKind?: AdapterKindDto;
  @ApiPropertyOptional() @IsOptional() @Transform(toBooleanQuery) @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN'] })
  @IsOptional() @IsIn(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN']) status?: string;
}

/** Solo operaciones de lectura: la consola de pruebas nunca crea, confirma ni cancela en el proveedor. */
export const TEST_CALL_OPERATIONS = ['SEARCH', 'GET_RATES', 'QUERY_BOOKING'] as const;
export type TestCallOperation = (typeof TEST_CALL_OPERATIONS)[number];

export class TestCallDto {
  @ApiProperty({ enum: TEST_CALL_OPERATIONS }) @IsIn(TEST_CALL_OPERATIONS)
  operation!: TestCallOperation;

  @ApiPropertyOptional({ type: AvailabilityQueryDto, description: 'Requerido para SEARCH' })
  @IsOptional() @ValidateNested() @Type(() => AvailabilityQueryDto)
  availability?: AvailabilityQueryDto;

  @ApiPropertyOptional({ type: RateQueryDto, description: 'Requerido para GET_RATES' })
  @IsOptional() @ValidateNested() @Type(() => RateQueryDto)
  rates?: RateQueryDto;

  @ApiPropertyOptional({ type: QueryBookingDto, description: 'Requerido para QUERY_BOOKING' })
  @IsOptional() @ValidateNested() @Type(() => QueryBookingDto)
  booking?: QueryBookingDto;
}
