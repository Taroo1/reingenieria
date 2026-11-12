import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { CloseInconsistencyDto, ListInconsistenciesQueryDto, ListSyncRunsQueryDto, RunSyncDto } from './dto/sync.dto';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('sync/runs')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({ summary: 'Ejecutar ahora una sincronizacion (CATALOG, AVAILABILITY, RATES o BOOKINGS) de una integracion' })
  run(@Body() dto: RunSyncDto) {
    return this.sync.run(dto.kind, dto.integrationId);
  }

  @Get('sync/runs')
  @Roles(...ALL_ROLES)
  runs(@Query() q: ListSyncRunsQueryDto) {
    return this.sync.listRuns(q);
  }

  @Get('sync/runs/:id')
  @Roles(...ALL_ROLES)
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.getRun(id);
  }

  @Get('inconsistencies')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Diferencias detectadas entre la base y los proveedores' })
  inconsistencies(@Query() q: ListInconsistenciesQueryDto) {
    return this.sync.listInconsistencies(q);
  }

  @Post('inconsistencies/:id/close')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseInconsistencyDto) {
    return this.sync.closeInconsistency(id, dto);
  }
}
