import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsStrongPassword, MaxLength } from 'class-validator';
import { PageQueryDto, toBooleanQuery } from '../../../common/dto/pagination.dto';
import { normalizeEmail, PASSWORD_POLICY, PASSWORD_POLICY_MESSAGE } from '../../auth/dto/auth.dto';
import { RoleName } from '../../auth/roles';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateUserDto {
  @ApiProperty() @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120)
  fullName!: string;

  @ApiProperty() @IsString() @MaxLength(128) @IsStrongPassword(PASSWORD_POLICY, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;

  @ApiProperty({ enum: RoleName }) @IsEnum(RoleName)
  role!: RoleName;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ enum: RoleName }) @IsOptional() @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(128) @IsStrongPassword(PASSWORD_POLICY, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class ListUsersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Busca en correo y nombre' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: RoleName }) @IsOptional() @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional() @IsOptional() @Transform(toBooleanQuery) @IsBoolean()
  active?: boolean;
}
