import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import type { Env } from './common/config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`API escuchando en el puerto ${port} (Swagger: /api/docs)`);
}

void bootstrap();
