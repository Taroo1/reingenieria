import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorBody } from '../api/api-response';
import { AppException } from '../errors/app.exception';
import { getCorrelationId } from '../context/request-context';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

interface Normalized {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Convierte cualquier error al formato uniforme sin filtrar detalles internos. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const n = this.normalize(exception);

    if (n.status >= 500) {
      this.logger.error(
        { err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: exception.stack } : exception },
        `Error no controlado en ${req.method} ${req.path}`,
      );
    }

    const body: ApiErrorBody = {
      error: { code: n.code, message: n.message, statusCode: n.status, ...(n.details !== undefined ? { details: n.details } : {}) },
      meta: { correlationId: getCorrelationId() ?? 'n/a', timestamp: new Date().toISOString(), path: req.path },
    };
    res.status(n.status).json(body);
  }

  private normalize(exception: unknown): Normalized {
    if (exception instanceof AppException) {
      return { status: exception.getStatus(), code: exception.code, message: exception.message, details: exception.details };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: 409, code: 'UNIQUE_VIOLATION', message: 'Ya existe un registro con esos valores unicos', details: { fields: (exception.meta as any)?.target } };
        case 'P2003':
          return { status: 409, code: 'FOREIGN_KEY_VIOLATION', message: 'La operacion viola una relacion con otros registros' };
        case 'P2004':
          return { status: 409, code: 'DB_CONSTRAINT_VIOLATION', message: 'La operacion viola una regla de integridad de los datos' };
        case 'P2025':
          return { status: 404, code: 'NOT_FOUND', message: 'Registro no encontrado' };
        default:
          return { status: 500, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const raw = typeof response === 'string' ? { message: response } : (response as Record<string, unknown>);
      const message = Array.isArray(raw.message) ? 'Solicitud invalida' : String(raw.message ?? exception.message);
      return {
        status,
        code: typeof raw.code === 'string' ? raw.code : (STATUS_CODES[status] ?? 'HTTP_ERROR'),
        // 503 es un estado de negocio esperado (proveedor caido): su mensaje si se informa.
        message: status >= 500 && status !== 503 ? 'Error interno del servidor' : message,
        details: raw.details,
      };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' };
  }
}
