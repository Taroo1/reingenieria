import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, IsStrongPassword, MaxLength } from 'class-validator';

/** Politica de contrasenas: 12+ caracteres con mayuscula, minuscula y numero; maximo 128 (evita abuso del hash). */
export const PASSWORD_POLICY = { minLength: 12, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 0 };
export const PASSWORD_POLICY_MESSAGE = 'La contrasena debe tener al menos 12 caracteres, con mayuscula, minuscula y numero';

export const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  @ApiProperty({ example: 'admin@mundoglobal.local' })
  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(256)
  refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(128)
  currentPassword!: string;

  @ApiProperty() @IsString() @MaxLength(128) @IsStrongPassword(PASSWORD_POLICY, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}
