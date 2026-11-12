import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/decorators/decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { RoleName } from '../auth/roles';
import { CreateUserDto, ListUsersQueryDto, ResetPasswordDto, UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

/** Gestion de usuarios: exclusiva del rol ADMIN. Los usuarios no se eliminan: se desactivan. */
@ApiTags('users')
@ApiBearerAuth()
@Roles(RoleName.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios' })
  list(@Query() q: ListUsersQueryDto) {
    return this.users.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @Idempotent({ scope: 'POST /users' })
  @ApiOperation({ summary: 'Crear usuario' })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar nombre, rol o estado (activo/inactivo)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.update(id, dto, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Establecer una nueva contrasena (cierra las sesiones del usuario)' })
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(id, dto.newPassword);
  }
}
