import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { AssignExceptionDto, CloseExceptionDto, ExceptionNoteDto, ListExceptionsQueryDto } from './dto/exceptions.dto';
import { ExceptionsService } from './exceptions.service';

@ApiTags('exceptions')
@ApiBearerAuth()
@Controller('exceptions')
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Bandeja de excepciones operativas' })
  list(@Query() q: ListExceptionsQueryDto) {
    return this.exceptions.list(q);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.get(id);
  }

  @Patch(':id/assign')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignExceptionDto) {
    return this.exceptions.assign(id, dto);
  }

  @Post(':id/notes')
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  note(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExceptionNoteDto) {
    return this.exceptions.note(id, dto);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseExceptionDto) {
    return this.exceptions.close(id, dto, 'RESOLVED');
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseExceptionDto) {
    return this.exceptions.close(id, dto, 'DISMISSED');
  }
}
