import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  correlationId: string;
  userId?: string;
  userEmail?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const CORRELATION_HEADER = 'x-correlation-id';
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Ejecuta fn dentro de un contexto propio (jobs en segundo plano, pruebas). */
export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return storage.run({ correlationId: ctx.correlationId ?? randomUUID(), ...ctx }, fn);
}

/** Asocia el usuario autenticado al contexto de la peticion en curso. */
export function setContextUser(user: { id: string; email: string; role: string }): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.userId = user.id;
    ctx.userEmail = user.email;
    ctx.role = user.role;
  }
}

/** Valida un identificador de correlacion recibido; si no es valido se genera uno nuevo. */
export function resolveCorrelationId(incoming: unknown): string {
  if (typeof incoming === 'string' && CORRELATION_PATTERN.test(incoming)) return incoming;
  return randomUUID();
}

/** Middleware Express: abre el contexto de la peticion y devuelve el correlation-id en la respuesta. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
  res.setHeader(CORRELATION_HEADER, correlationId);
  const ua = req.headers['user-agent'];
  storage.run(
    { correlationId, ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined },
    () => next(),
  );
}
