import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public, Roles } from '../../common/decorators/decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto/auth.dto';
import { ALL_ROLES } from './roles';

/** Limite estricto por IP para endpoints de credenciales (LOGIN_THROTTLE_LIMIT por ventana). Se lee en cada peticion. */
const credentialThrottle = () => ({
  default: { limit: () => Number(process.env.LOGIN_THROTTLE_LIMIT ?? 5), ttl: () => Number(process.env.THROTTLE_TTL_MS ?? 60000) },
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(credentialThrottle())
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar sesion (limitado por IP)' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle(credentialThrottle())
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renovar la sesion: rota el refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cerrar sesion: invalida el refresh token' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Usuario autenticado' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @Patch('password')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Cambiar la propia contrasena (cierra las demas sesiones)' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }
}
