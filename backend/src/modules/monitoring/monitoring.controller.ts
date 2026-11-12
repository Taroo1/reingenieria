import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { ListAlertsQueryDto } from './dto/monitoring.dto';
import { MonitoringService } from './monitoring.service';

@ApiTags('monitoring')
@ApiBearerAuth()
@Controller()
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('monitoring/overview')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Tablero: salud por integracion (24 h: tasa de exito, p50/p95), circuitos, alertas, excepciones y reservas' })
  overview() {
    return this.monitoring.overview();
  }

  @Get('alerts')
  @Roles(...ALL_ROLES)
  alerts(@Query() q: ListAlertsQueryDto) {
    return this.monitoring.listAlerts(q);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  acknowledge(@Param('id', ParseUUIDPipe) id: string) {
    return this.monitoring.acknowledge(id);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  resolve(@Param('id', ParseUUIDPipe) id: string) {
    return this.monitoring.resolve(id);
  }
}
