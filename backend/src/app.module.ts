import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from './common/config/env.validation';
import { validateEnv } from './common/config/env.validation';
import { getCorrelationId, getRequestContext } from './common/context/request-context';
import { PrismaModule } from './common/database/prisma.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { SecurityModule } from './common/security/security.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { UsersModule } from './modules/users/users.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ExceptionsModule } from './modules/exceptions/exceptions.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { RatesModule } from './modules/rates/rates.module';
import { SearchModule } from './modules/search/search.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'], validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          // El id de la peticion es el correlationId: unifica logs, auditoria y transacciones.
          genReqId: () => getCorrelationId() ?? 'n/a',
          customProps: () => ({ correlationId: getCorrelationId(), userId: getRequestContext()?.userId }),
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.refreshToken', 'req.body.credentials', 'res.headers["set-cookie"]'],
            censor: '[REDACTED]',
          },
          autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/v1/health') },
        },
      }),
    }),
    // Almacenamiento en memoria por proceso; con varias replicas se migra a Redis (Etapa 3/5).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [{ ttl: config.get('THROTTLE_TTL_MS'), limit: config.get('THROTTLE_LIMIT') }],
    }),
    PrismaModule,
    IdempotencyModule,
    SecurityModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ProvidersModule,
    IntegrationsModule,
    MonitoringModule,
    // Etapa 3: logica de negocio
    CatalogModule,
    InventoryModule,
    RatesModule,
    PricingModule,
    SearchModule,
    QuotesModule,
    ExceptionsModule,
    BookingsModule,
    SyncModule,
    JobsModule,
  ],
  providers: [
    // Orden de ejecucion de guards: limite de peticiones -> autenticacion -> roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
