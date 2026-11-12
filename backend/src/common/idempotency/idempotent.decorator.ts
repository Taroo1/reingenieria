import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IDEMPOTENT_KEY, IdempotencyInterceptor, IdempotentOptions } from './idempotency.interceptor';

/**
 * Hace idempotente un endpoint con la cabecera Idempotency-Key: repetir la solicitud con la misma clave
 * devuelve la misma respuesta (cabecera Idempotent-Replayed: true) sin volver a ejecutarla.
 */
export const Idempotent = (options: IdempotentOptions) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, options),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: options.required ?? false,
      description: 'Clave unica por operacion (8-128 caracteres [A-Za-z0-9._:-]). Reintentar con la misma clave no duplica la operacion.',
    }),
  );
