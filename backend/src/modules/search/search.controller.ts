import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { RoleName } from '../auth/roles';
import { SearchDto } from './dto/search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post()
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({
    summary: 'Busqueda unificada (cupo propio + proveedores en vivo)',
    description: 'La disponibilidad PROVIDER_LIVE es orientativa: se revalida con el proveedor antes de confirmar. La falla de un proveedor se informa en providers[] sin anular el resto.',
  })
  run(@Body() dto: SearchDto) {
    return this.search.search(dto);
  }
}
