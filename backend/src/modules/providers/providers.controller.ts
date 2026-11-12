import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ALL_ROLES, RoleName } from '../auth/roles';
import {
  CreateProviderDto, ListProvidersQueryDto, ProviderConfigDto, SetServicesDto, UpdateProviderDto,
} from './dto/providers.dto';
import { ProvidersService } from './providers.service';

/** Lectura: todos los roles. Escritura: ADMIN. Las credenciales son de solo escritura y nunca se devuelven. */
@ApiTags('providers')
@ApiBearerAuth()
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Listar proveedores' })
  list(@Query() q: ListProvidersQueryDto) {
    return this.providers.list(q);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.get(id);
  }

  @Post()
  @Roles(RoleName.ADMIN)
  @Idempotent({ scope: 'POST /providers' })
  @ApiOperation({ summary: 'Crear proveedor (con ficha tecnica y servicios opcionales)' })
  create(@Body() dto: CreateProviderDto) {
    return this.providers.create(dto);
  }

  @Patch(':id')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Editar datos o activar/desactivar' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProviderDto) {
    return this.providers.update(id, dto);
  }

  @Put(':id/config')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Definir la ficha tecnica de conexion (credenciales cifradas)' })
  upsertConfig(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderConfigDto) {
    return this.providers.upsertConfig(id, dto);
  }

  @Put(':id/services')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Reemplazar los servicios y capacidades del proveedor' })
  setServices(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetServicesDto) {
    return this.providers.setServices(id, dto.services);
  }

  @Delete(':id')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Eliminar (solo si no tiene historial); si lo tiene, desactivar' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.remove(id);
  }
}
