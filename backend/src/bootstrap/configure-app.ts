import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Env } from '../common/config/env.validation';
import { CORRELATION_HEADER, requestContextMiddleware } from '../common/context/request-context';
import { REPLAYED_HEADER } from '../common/idempotency/idempotency.interceptor';

export const API_PREFIX = 'api/v1';

/** Configuracion comun de la aplicacion (la usa main.ts y la reutilizaran los tests e2e). */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const express = app as NestExpressApplication;

  if (config.get('TRUST_PROXY')) express.set('trust proxy', 1);
  express.disable('x-powered-by');

  // El contexto (correlationId, ip, user-agent) debe existir antes que cualquier otro middleware/guard.
  app.use(requestContextMiddleware);
  app.use(helmet());

  const corsOrigins: string = config.get('CORS_ORIGINS', { infer: true });
  const origins = corsOrigins.split(',').map((o: string) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: false, // la sesion viaja en Authorization, no en cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', CORRELATION_HEADER],
    exposedHeaders: [CORRELATION_HEADER, REPLAYED_HEADER],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED')) {
    const doc = new DocumentBuilder()
      .setTitle('MundoGlobalTravel - Motor Orquestador')
      .setDescription('API de integracion con proveedores, inventario centralizado y reservas.')
      .setVersion('0.2.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs-json' });
  }
}
