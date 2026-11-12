import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../common/config/env.validation';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthUser } from '../../common/decorators/decorators';
import { Errors } from '../../common/errors/app.exception';
import { PasswordHasher } from '../../common/security/password-hasher';
import { AuditService } from '../audit/audit.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';
import { generateRefreshToken, hashToken, refreshExpiry } from './token.util';

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Segundos de vida del access token. */
  expiresIn: number;
  user: { id: string; email: string; fullName: string; role: string };
}

type UserWithRole = { id: string; email: string; fullName: string; role: { name: string } };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(dto: LoginDto): Promise<TokenResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email }, include: { role: true } });

    if (!user) {
      // Mismo costo de CPU que un intento real: la respuesta no revela si el correo existe.
      await this.hasher.burn(dto.password);
      await this.audit.record({ action: 'AUTH_LOGIN_FAILED', entity: 'user', userId: null, after: { email: dto.email, reason: 'unknown_user' } });
      throw this.invalidCredentials();
    }

    const passwordOk = await this.hasher.verify(user.passwordHash, dto.password);
    if (!passwordOk || !user.active) {
      await this.audit.record({
        action: 'AUTH_LOGIN_FAILED',
        entity: 'user',
        entityId: user.id,
        userId: user.id,
        after: { email: user.email, reason: passwordOk ? 'inactive_user' : 'wrong_password' },
      });
      throw this.invalidCredentials();
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ action: 'AUTH_LOGIN', entity: 'user', entityId: user.id, userId: user.id });
    return this.issueTokens(user);
  }

  /** Rotacion: cada refresh token sirve una sola vez. Reutilizar uno ya rotado revoca todas las sesiones del usuario. */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { include: { role: true } } },
    });
    if (!record) throw this.invalidRefresh();

    if (record.revokedAt) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: record.userId } });
      await this.audit.record({ action: 'AUTH_REFRESH_REUSE_DETECTED', entity: 'user', entityId: record.userId, userId: record.userId });
      throw this.invalidRefresh();
    }
    if (record.expiresAt <= new Date() || !record.user.active) throw this.invalidRefresh();

    // Reclamo atomico: si dos peticiones llegan a la vez con el mismo token, solo una gana.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw this.invalidRefresh();

    return this.issueTokens(record.user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(refreshToken) } });
  }

  async me(authUser: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.id }, include: { role: true } });
    return { id: user.id, email: user.email, fullName: user.fullName, role: user.role.name, lastLoginAt: user.lastLoginAt };
  }

  async changePassword(authUser: AuthUser, dto: ChangePasswordDto): Promise<{ changed: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: authUser.id } });
    if (!(await this.hasher.verify(user.passwordHash, dto.currentPassword))) {
      throw Errors.badRequest('CURRENT_PASSWORD_INCORRECT', 'La contrasena actual no es correcta');
    }
    if (await this.hasher.verify(user.passwordHash, dto.newPassword)) {
      throw Errors.badRequest('PASSWORD_UNCHANGED', 'La nueva contrasena debe ser distinta de la actual');
    }
    const passwordHash = await this.hasher.hash(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      await this.audit.record({ action: 'AUTH_PASSWORD_CHANGED', entity: 'user', entityId: user.id }, tx);
    });
    return { changed: true };
  }

  private async issueTokens(user: UserWithRole): Promise<TokenResponse> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role.name };
    const accessToken = await this.jwt.signAsync(payload);
    const decoded = this.jwt.decode(accessToken) as { exp: number; iat: number };

    const refreshToken = generateRefreshToken();
    const ctx = getRequestContext();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiry(this.config.get('REFRESH_TOKEN_TTL_DAYS')),
        userAgent: ctx?.userAgent ?? null,
        ip: ctx?.ip ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: decoded.exp - decoded.iat,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role.name },
    };
  }

  private invalidCredentials() {
    return Errors.unauthorized('INVALID_CREDENTIALS', 'Correo o contrasena incorrectos');
  }

  private invalidRefresh() {
    return Errors.unauthorized('INVALID_REFRESH_TOKEN', 'La sesion expiro o no es valida. Inicie sesion nuevamente');
  }
}
