import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, CreateBookingDto, ListBookingsQueryDto } from './dto/bookings.dto';

/**
 * Las operaciones que cambian el estado de una reserva exigen Idempotency-Key: reintentar una peticion
 * (p. ej. por un corte de red) devuelve el mismo resultado sin volver a bloquear, confirmar ni cancelar.
 */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /bookings', required: true })
  @ApiOperation({ summary: 'Crear la reserva desde una cotizacion vigente (estado QUOTED)' })
  create(@Body() dto: CreateBookingDto) {
    return this.bookings.create(dto);
  }

  @Get()
  @Roles(...ALL_ROLES)
  list(@Query() q: ListBookingsQueryDto) {
    return this.bookings.list(q);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(id);
  }

  @Get(':id/transactions')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Llamadas a proveedores hechas para esta reserva (trazabilidad)' })
  transactions(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.transactions(id);
  }

  @Post(':id/hold')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /bookings/:id/hold', required: true })
  @ApiOperation({ summary: 'Bloquear: cupo propio (atomico) y bloqueo en el proveedor si lo permite (QUOTED -> HELD)' })
  hold(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.hold(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /bookings/:id/confirm', required: true })
  @ApiOperation({
    summary: 'Confirmar con los proveedores (HELD -> CONFIRMED | PENDING_CONFIRMATION | FAILED | REQUIRES_REVIEW)',
    description: 'Revalida disponibilidad y precio de lo que es en vivo. Un timeout deja el item pendiente y se concilia: nunca se marca confirmado sin localizador del proveedor. Una falla parcial compensa (cancela lo ya confirmado).',
  })
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.confirm(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /bookings/:id/cancel', required: true })
  @ApiOperation({ summary: 'Cancelar una reserva confirmada (CONFIRMED -> CANCEL_REQUESTED -> CANCELLED)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBookingDto) {
    return this.bookings.cancel(id, dto);
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @ApiOperation({ summary: 'Conciliar ahora los items pendientes consultando al proveedor (no reenvia nada)' })
  reconcile(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.reconcileBooking(id);
  }
}
