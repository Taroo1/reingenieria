import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PageQueryDto, toBooleanQuery } from '../../../common/dto/pagination.dto';

export enum ProviderTypeDto { GDS = 'GDS', AIRLINE = 'AIRLINE', CONSOLIDATOR = 'CONSOLIDATOR', HOTEL = 'HOTEL', BEDBANK = 'BEDBANK', TRAVEL_ASSISTANCE = 'TRAVEL_ASSISTANCE' }
export enum AuthTypeDto { NONE = 'NONE', API_KEY = 'API_KEY', BEARER = 'BEARER', BASIC = 'BASIC', OAUTH2_CLIENT = 'OAUTH2_CLIENT' }
export enum ProductTypeDto { FLIGHT = 'FLIGHT', ROOM = 'ROOM', ASSISTANCE_PLAN = 'ASSISTANCE_PLAN' }

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CredentialsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) apiKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) token?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) username?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) password?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) clientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) clientSecret?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) tokenUrl?: string;
}

export class ProviderConfigDto {
  @ApiProperty({ example: 'https://api.proveedor.com/v1' })
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2048)
  baseUrl!: string;

  @ApiProperty({ enum: AuthTypeDto }) @IsEnum(AuthTypeDto)
  authType!: AuthTypeDto;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  authHeaderName?: string;

  @ApiPropertyOptional({ description: 'Solo escritura. Si se omite al editar, se conservan las actuales. Nunca se devuelve.' })
  @IsOptional() @ValidateNested() @Type(() => CredentialsDto)
  credentials?: CredentialsDto;

  @ApiPropertyOptional({ default: 8000 }) @IsOptional() @IsInt() @Min(100) @Max(60000) timeoutMs?: number;
  @ApiPropertyOptional({ default: 3 }) @IsOptional() @IsInt() @Min(0) @Max(10) maxRetries?: number;
  @ApiPropertyOptional({ default: 200 }) @IsOptional() @IsInt() @Min(10) @Max(60000) retryBaseMs?: number;
  @ApiPropertyOptional({ default: 5000 }) @IsOptional() @IsInt() @Min(10) @Max(300000) retryMaxMs?: number;
  @ApiPropertyOptional({ default: 5 }) @IsOptional() @IsInt() @Min(1) @Max(100) cbFailureThreshold?: number;
  @ApiPropertyOptional({ default: 30000 }) @IsOptional() @IsInt() @Min(1000) @Max(3600000) cbResetTimeoutMs?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(20) cbHalfOpenMaxCalls?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() supportsIdempotency?: boolean;
  @ApiPropertyOptional({ description: 'Parametros libres (healthPath, rutas...)' }) @IsOptional() @IsObject() params?: Record<string, unknown>;
}

export class ServiceCapabilityDto {
  @ApiProperty({ enum: ProductTypeDto }) @IsEnum(ProductTypeDto) serviceType!: ProductTypeDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canSearch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canHold?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canConfirm?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canCancel?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() canQueryStatus?: boolean;
}

export class SetServicesDto {
  @ApiProperty({ type: [ServiceCapabilityDto] })
  @IsArray() @ArrayUnique((s: ServiceCapabilityDto) => s.serviceType) @ValidateNested({ each: true }) @Type(() => ServiceCapabilityDto)
  services!: ServiceCapabilityDto[];
}

export class CreateProviderDto {
  @ApiProperty({ example: 'AMADEUS_SIM' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString() @Matches(/^[A-Z0-9_]{2,40}$/, { message: 'code: 2-40 caracteres, mayusculas, numeros o guion bajo' })
  code!: string;

  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ProviderTypeDto }) @IsEnum(ProviderTypeDto)
  type!: ProviderTypeDto;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: ProviderConfigDto }) @IsOptional() @ValidateNested() @Type(() => ProviderConfigDto)
  config?: ProviderConfigDto;

  @ApiPropertyOptional({ type: [ServiceCapabilityDto] })
  @IsOptional() @IsArray() @ArrayUnique((s: ServiceCapabilityDto) => s.serviceType) @ValidateNested({ each: true }) @Type(() => ServiceCapabilityDto)
  services?: ServiceCapabilityDto[];
}

export class UpdateProviderDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ enum: ProviderTypeDto }) @IsOptional() @IsEnum(ProviderTypeDto) type?: ProviderTypeDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ListProvidersQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: ProviderTypeDto }) @IsOptional() @IsEnum(ProviderTypeDto) type?: ProviderTypeDto;
  @ApiPropertyOptional() @IsOptional() @Transform(toBooleanQuery) @IsBoolean() active?: boolean;
}
