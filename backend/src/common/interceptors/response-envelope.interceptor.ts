import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { ApiMeta, ApiSuccess, PageResult, WithMeta } from '../api/api-response';
import { getCorrelationId } from '../context/request-context';
import { SKIP_ENVELOPE_KEY } from '../decorators/decorators';

/** Envuelve toda respuesta exitosa en { data, meta: { correlationId, ... } }. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [context.getHandler(), context.getClass()]);
    if (skip) return next.handle();

    return next.handle().pipe(
      map((payload): ApiSuccess<unknown> => {
        const base: ApiMeta = { correlationId: getCorrelationId() ?? 'n/a' };
        if (payload instanceof PageResult) {
          return {
            data: payload.items,
            meta: {
              ...base,
              page: payload.page,
              pageSize: payload.pageSize,
              total: payload.total,
              totalPages: Math.max(1, Math.ceil(payload.total / payload.pageSize)),
            },
          };
        }
        if (payload instanceof WithMeta) {
          return { data: payload.data, meta: { ...base, ...payload.meta } };
        }
        return { data: payload === undefined ? null : payload, meta: base };
      }),
    );
  }
}
