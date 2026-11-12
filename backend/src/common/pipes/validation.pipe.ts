import { ValidationError, ValidationPipe } from '@nestjs/common';
import { Errors } from '../errors/app.exception';

interface FieldIssue {
  field: string;
  messages: string[];
}

function flatten(errors: ValidationError[], parent = ''): FieldIssue[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/**
 * Validacion global: lista blanca de campos, rechazo de campos desconocidos y errores
 * con formato uniforme (VALIDATION_ERROR + detalle por campo).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
    exceptionFactory: (errors) => Errors.badRequest('VALIDATION_ERROR', 'Los datos enviados no son validos', flatten(errors)),
  });
}
