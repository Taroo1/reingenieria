import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { PageQueryDto } from '../../common/dto/pagination.dto';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { CreateIntegrationDto, ListIntegrationsQueryDto, TestCallDto, UpdateIntegrationDto } from './dto/integrations.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @Roles(...ALL_ROLES)
  list(@Query() q: ListIntegrationsQueryDto) {
    return this.integrations.list(q);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.get(id);
  }

  @Get(':id/health-checks')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Historial de comprobaciones de conectividad' })
  history(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQueryDto) {
    return this.integrations.healthHistory(id, q);
  }

  @Post()
  @Roles(RoleName.ADMIN)
  @Idempotent({ scope: 'POST /integrations' })
  create(@Body() dto: CreateIntegrationDto) {
    return this.integrations.create(dto);
  }

  @Patch(':id')
  @Roles(RoleName.ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrations.update(id, dto);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @Roles(RoleName.ADMIN)
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.setEnabled(id, true);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @Roles(RoleName.ADMIN)
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.setEnabled(id, false);
  }

  @Post(':id/health-check')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({ summary: 'Probar la conectividad ahora (llamada real segun el tipo de adaptador)' })
  healthCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.runHealthCheck(id);
  }

  @Post(':id/test-call')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({
    summary: 'Consola de pruebas: lectura real contra el proveedor (SEARCH, GET_RATES, QUERY_BOOKING)',
    description: 'Pasa por el motor de integracion (timeout, reintentos, circuit breaker, trazabilidad). Nunca escribe en el proveedor. Un fallo del proveedor se informa con ok=false.',
  })
  testCall(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TestCallDto) {
    return this.integrations.testCall(id, dto);
  }

  @Post(':id/circuit/reset')
  @HttpCode(200)
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Cerrar manualmente el circuit breaker (resuelve la alerta de circuito abierto)' })
  resetCircuit(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.resetCircuit(id);
  }

  @Delete(':id')
  @Roles(RoleName.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.remove(id);
  }
}
