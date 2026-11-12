import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC_KEY, ROLES_KEY } from '../../../common/decorators/decorators';
import { Errors } from '../../../common/errors/app.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Autorizacion por roles, global. Denegar por defecto:
 *  - con @Roles(...): solo esos roles;
 *  - sin @Roles: cualquier usuario autenticado puede LEER, pero modificar exige declarar roles.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) throw Errors.unauthorized('UNAUTHENTICATED', 'Debe iniciar sesion para acceder a este recurso');

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets);
    if (!roles || roles.length === 0) {
      if (SAFE_METHODS.has(req.method)) return true;
      throw Errors.forbidden('FORBIDDEN', 'No tiene permisos para realizar esta operacion');
    }
    if (!roles.includes(user.role)) {
      throw Errors.forbidden('FORBIDDEN', 'No tiene permisos para realizar esta operacion');
    }
    return true;
  }
}
