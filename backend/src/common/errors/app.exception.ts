import { HttpException, HttpStatus } from '@nestjs/common';

/** Excepcion de negocio con codigo estable. El filtro global la convierte al formato ApiErrorBody. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  badRequest: (code: string, message: string, details?: unknown) =>
    new AppException(HttpStatus.BAD_REQUEST, code, message, details),
  unauthorized: (code: string, message: string) =>
    new AppException(HttpStatus.UNAUTHORIZED, code, message),
  forbidden: (code: string, message: string) =>
    new AppException(HttpStatus.FORBIDDEN, code, message),
  notFound: (code: string, message: string) =>
    new AppException(HttpStatus.NOT_FOUND, code, message),
  conflict: (code: string, message: string, details?: unknown) =>
    new AppException(HttpStatus.CONFLICT, code, message, details),
  unprocessable: (code: string, message: string, details?: unknown) =>
    new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details),
  /** Dependencia externa (proveedor) no disponible: reintentar mas tarde. */
  unavailable: (code: string, message: string, details?: unknown) =>
    new AppException(HttpStatus.SERVICE_UNAVAILABLE, code, message, details),
};
