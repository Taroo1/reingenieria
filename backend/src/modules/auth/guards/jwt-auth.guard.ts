import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY, AuthUser } from '../../../common/decorators/decorators';
import { setContextUser } from '../../../common/context/request-context';
import { Errors } from '../../../common/errors/app.exception';

/** Guard global: toda ruta exige JWT valido salvo las marcadas con @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser = AuthUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw Errors.unauthorized('UNAUTHENTICATED', 'Debe iniciar sesion para acceder a este recurso');
    }
    setContextUser(user as unknown as AuthUser);
    return user;
  }
}
