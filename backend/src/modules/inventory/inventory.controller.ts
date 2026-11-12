import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { AllotmentsService } from './allotments.service';
import { AdjustLevelDto, CreateAllotmentDto, LevelsQueryDto, ListAllotmentsQueryDto, MovementsQueryDto } from './dto/inventory.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly allotments: AllotmentsService) {}

  @Get('allotments')
  @Roles(...ALL_ROLES)
  list(@Query() q: ListAllotmentsQueryDto) {
    return this.allotments.list(q);
  }

  @Post('allotments')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /inventory/allotments' })
  @ApiOperation({ summary: 'Cargar un cupo contratado (suma unidades a cada fecha del periodo)' })
  create(@Body() dto: CreateAllotmentDto) {
    return this.allotments.create(dto);
  }

  @Delete('allotments/:id')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({ summary: 'Retirar un cupo (solo si las fechas futuras no quedan con sobreventa)' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.allotments.deactivate(id);
  }

  @Get('levels')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Cupo por fecha: total, bloqueado, vendido y disponible' })
  levels(@Query() q: LevelsQueryDto) {
    return this.allotments.levels(q);
  }

  @Post('levels/adjust')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({ summary: 'Ajuste manual del total de una fecha (queda en el libro de movimientos)' })
  adjust(@Body() dto: AdjustLevelDto) {
    return this.allotments.adjust(dto);
  }

  @Get('levels/:id/movements')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Libro de movimientos de una fecha (solo insercion)' })
  movements(@Param('id', ParseUUIDPipe) id: string, @Query() q: MovementsQueryDto) {
    return this.allotments.movements(id, q);
  }
}
