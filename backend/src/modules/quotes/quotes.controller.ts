import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ALL_ROLES, RoleName } from '../auth/roles';
import { CreateQuoteDto, ListQuotesQueryDto } from './dto/quotes.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @Roles(RoleName.ADMIN, RoleName.OPERADOR)
  @Idempotent({ scope: 'POST /quotes' })
  @ApiOperation({ summary: 'Cotizar uno o varios items (precio vigente, convertido a una moneda)' })
  create(@Body() dto: CreateQuoteDto) {
    return this.quotes.create(dto);
  }

  @Get()
  @Roles(...ALL_ROLES)
  list(@Query() q: ListQuotesQueryDto) {
    return this.quotes.list(q);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }
}
