import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { ALL_ROLES } from '../auth/roles';
import { CatalogService } from './catalog.service';
import { ListProductsQueryDto } from './dto/catalog.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Catalogo normalizado (vuelos, habitaciones y planes de asistencia de todos los proveedores)' })
  list(@Query() q: ListProductsQueryDto) {
    return this.catalog.list(q);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Producto con su detalle y sus referencias externas' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(id);
  }
}
