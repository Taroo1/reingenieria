import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { getRequestContext } from '../context/request-context';
import { AppException, Errors } from '../errors/app.exception';
import { IdempotencyService, isStoredError, StoredError } from './idempotency.service';
import { IDEMPOTENCY_KEY_PATTERN, requestFingerprint } from './request-fingerprint';

export const IDEMPOTENT_KEY = 'idempotent';
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';

export interface IdempotentOptions {
  /** Alcance de la clave (p. ej. "POST /bookings"). */
  scope: string;
  /** Si es true, la cabecera es obligatoria (operaciones que crean reservas o cobran). */
  required?: boolean;
  /** Vigencia de la clave (por defecto 24 h). */
  ttlMs?: number;
}

/** Errores deterministas: repetir la misma solicitud daria el mismo resultado, se guardan y se repiten. */
const CACHEABLE_ERRORS = new Set([HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.UNPROCESSABLE_ENTITY]);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const opts = this.reflector.get<IdempotentOptions | undefined>(IDEMPOTENT_KEY, context.getHandler());
    if (!opts) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const raw = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) {
      if (opts.required) throw Errors.badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Esta operacion requiere la cabecera Idempotency-Key');
      return next.handle();
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw Errors.badRequest('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key debe tener entre 8 y 128 caracteres [A-Za-z0-9._:-]');
    }

    const userId = getRequestContext()?.userId ?? null;
    const hash = requestFingerprint({
      method: req.method,
      route: (req.route as { path?: string } | undefined)?.path ?? req.path,
      params: req.params,
      query: req.query,
      body: req.body,
      userId,
    });
    const claim = await this.idempotency.claim(opts.scope, key, hash, userId, opts.ttlMs ?? 24 * 3600_000);

    if (claim.kind === 'replay') {
      res.setHeader(REPLAYED_HEADER, 'true');
      if (isStoredError(claim.body)) {
        const e = claim.body.error;
        throw new AppException(e.status, e.code, e.message, e.details);
      }
      res.status(claim.status);
      return of(claim.body);
    }

    const handler = context.getHandler();
    const successStatus: number = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, handler) ?? (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    return next.handle().pipe(
      mergeMap((body) => from(this.idempotency.complete(claim.id, successStatus, body).then(() => body))),
      catchError((err: unknown) => {
        const status = err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
        const persist = CACHEABLE_ERRORS.has(status) && err instanceof HttpException
          ? this.idempotency.complete(claim.id, status, this.toStoredError(err, status))
          : this.idempotency.fail(claim.id);
        return from(persist.catch(() => undefined)).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }

  private toStoredError(err: HttpException, status: number): StoredError {
    if (err instanceof AppException) return { error: { status, code: err.code, message: err.message, details: err.details } };
    const r = err.getResponse();
    const body = typeof r === 'string' ? { message: r } : (r as Record<string, unknown>);
    const message = Array.isArray(body.message) ? 'Solicitud invalida' : String(body.message ?? err.message);
    return { error: { status, code: typeof body.code === 'string' ? body.code : 'BAD_REQUEST', message, details: body.details } };
  }
}
