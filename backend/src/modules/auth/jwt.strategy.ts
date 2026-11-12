import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthUser } from '../../common/decorators/decorators';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Se consulta la base en cada peticion: un usuario desactivado o con otro rol pierde acceso
   * de inmediato, sin esperar a que venza el token.
   */
  async validate(payload: JwtPayload): Promise<AuthUser | false> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user || !user.active) return false;
    return { id: user.id, email: user.email, fullName: user.fullName, role: user.role.name };
  }
}
