import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/** Endpoint sin autenticacion (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Roles permitidos. Un endpoint que modifica datos y no declara roles es rechazado (denegar por defecto). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** La respuesta no se envuelve en { data, meta } (health checks). */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return req.user;
});
