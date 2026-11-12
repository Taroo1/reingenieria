import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageResult } from '../../common/api/api-response';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { AuthUser } from '../../common/decorators/decorators';
import { Errors } from '../../common/errors/app.exception';
import { PasswordHasher } from '../../common/security/password-hasher';
import { AuditService } from '../audit/audit.service';
import { RoleName } from '../auth/roles';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/users.dto';

type UserRow = Prisma.UserGetPayload<{ include: { role: true } }>;

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Nunca expone passwordHash. */
export function toUserView(u: UserRow): UserView {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role.name,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListUsersQueryDto): Promise<PageResult<UserView>> {
    const where: Prisma.UserWhereInput = {
      ...(q.active !== undefined && { active: q.active }),
      ...(q.role && { role: { name: q.role } }),
      ...(q.search && {
        OR: [
          { email: { contains: q.search, mode: 'insensitive' } },
          { fullName: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: { role: true }, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return new PageResult(rows.map(toUserView), total, q.page, q.pageSize);
  }

  async get(id: string): Promise<UserView> {
    const row = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!row) throw Errors.notFound('USER_NOT_FOUND', 'Usuario no encontrado');
    return toUserView(row);
  }

  async create(dto: CreateUserDto): Promise<UserView> {
    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) throw Errors.badRequest('ROLE_NOT_FOUND', 'El rol indicado no existe');
    if (await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw Errors.conflict('EMAIL_IN_USE', 'Ya existe un usuario con ese correo');
    }

    const passwordHash = await this.hasher.hash(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.user.create({
        data: { email: dto.email, fullName: dto.fullName, passwordHash, roleId: role.id },
        include: { role: true },
      });
      const view = toUserView(row);
      await this.audit.record({ action: 'USER_CREATED', entity: 'user', entityId: row.id, after: view }, tx);
      return view;
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<UserView> {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.user.findUnique({ where: { id }, include: { role: true } });
        if (!current) throw Errors.notFound('USER_NOT_FOUND', 'Usuario no encontrado');

        const newRole = dto.role ?? current.role.name;
        const newActive = dto.active ?? current.active;

        if (id === actor.id && (newActive === false || newRole !== current.role.name)) {
          throw Errors.conflict('SELF_MODIFICATION_NOT_ALLOWED', 'No puede desactivarse ni cambiar su propio rol');
        }
        const losesAdmin = current.role.name === RoleName.ADMIN && current.active && (newRole !== RoleName.ADMIN || !newActive);
        if (losesAdmin) await this.assertAnotherActiveAdmin(tx, id);

        const roleId = dto.role ? (await this.requireRole(tx, dto.role)).id : undefined;
        const row = await tx.user.update({
          where: { id },
          data: {
            ...(dto.fullName !== undefined && { fullName: dto.fullName }),
            ...(roleId && { roleId }),
            ...(dto.active !== undefined && { active: dto.active }),
          },
          include: { role: true },
        });

        // Un cambio de rol o la desactivacion cierran las sesiones abiertas.
        if (newActive === false || newRole !== current.role.name) {
          await tx.refreshToken.deleteMany({ where: { userId: id } });
        }
        const view = toUserView(row);
        await this.audit.record({ action: 'USER_UPDATED', entity: 'user', entityId: id, before: toUserView(current), after: view }, tx);
        return view;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async resetPassword(id: string, newPassword: string): Promise<{ changed: true }> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw Errors.notFound('USER_NOT_FOUND', 'Usuario no encontrado');
    const passwordHash = await this.hasher.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      await this.audit.record({ action: 'USER_PASSWORD_RESET', entity: 'user', entityId: id }, tx);
    });
    return { changed: true };
  }

  private async requireRole(tx: PrismaTx, name: string) {
    const role = await tx.role.findUnique({ where: { name } });
    if (!role) throw Errors.badRequest('ROLE_NOT_FOUND', 'El rol indicado no existe');
    return role;
  }

  private async assertAnotherActiveAdmin(tx: PrismaTx, excludingUserId: string): Promise<void> {
    const others = await tx.user.count({ where: { id: { not: excludingUserId }, active: true, role: { name: RoleName.ADMIN } } });
    if (others === 0) {
      throw Errors.conflict('LAST_ADMIN', 'Debe quedar al menos un administrador activo');
    }
  }
}
