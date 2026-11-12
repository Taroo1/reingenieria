import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { RoleName } from '../auth/roles';
import { AuditService } from './audit.service';
import { AuditLogQueryDto, SystemLogQueryDto, TransactionQueryDto } from './dto/audit-query.dto';
import { SystemLogService } from './system-log.service';
import { TransactionsService } from './transactions.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly systemLogs: SystemLogService,
    private readonly transactions: TransactionsService,
  ) {}

  @Get('logs')
  @Roles(RoleName.ADMIN, RoleName.CONSULTA)
  @ApiOperation({ summary: 'Auditoria de acciones de usuario (solo lectura)' })
  logs(@Query() q: AuditLogQueryDto) {
    return this.audit.list(q);
  }

  @Get('transactions')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR, RoleName.CONSULTA)
  @ApiOperation({ summary: 'Historial de transacciones de integracion' })
  listTransactions(@Query() q: TransactionQueryDto) {
    return this.transactions.list(q);
  }

  @Get('transactions/:id')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR, RoleName.CONSULTA)
  @ApiOperation({ summary: 'Detalle de una transaccion con sus intentos' })
  getTransaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactions.get(id);
  }

  @Get('system-logs')
  @Roles(RoleName.ADMIN, RoleName.CONSULTA)
  @ApiOperation({ summary: 'Eventos del sistema' })
  systemLogsList(@Query() q: SystemLogQueryDto) {
    return this.systemLogs.list(q);
  }
}
