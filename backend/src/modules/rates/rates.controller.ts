import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { CreateRateDto, ListRatesQueryDto, UpdateRateDto } from './dto/rates.dto';
import { RatesService } from './rates.service';

@ApiTags('rates')
@ApiBearerAuth()
@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  @Roles(...ALL_ROLES)
  list(@Query() q: ListRatesQueryDto) {
    return this.rates.list(q);
  }

  @Post()
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /rates' })
  @ApiOperation({ summary: 'Alta de tarifa' })
  create(@Body() dto: CreateRateDto) {
    return this.rates.create(dto);
  }

  @Patch(':id')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({ summary: 'Modificar tarifa (el cambio de importe queda en el historial con su motivo)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRateDto) {
    return this.rates.update(id, dto);
  }

  @Get(':id/history')
  @Roles(...ALL_ROLES)
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.rates.history(id);
  }
}
