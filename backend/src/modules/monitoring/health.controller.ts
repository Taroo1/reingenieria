import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, SkipEnvelope } from '../../common/decorators/decorators';
import { PrismaService } from '../../common/database/prisma.service';

/** Sondas para Docker/orquestador. Publicas y sin envoltorio; no exponen datos internos. */
@ApiTags('monitoring')
@Public()
@SkipEnvelope()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'El proceso esta vivo' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Listo para recibir trafico (verifica la base de datos)' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      throw new HttpException({ status: 'unavailable', checks: { database: 'down' } }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
