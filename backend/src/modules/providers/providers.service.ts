import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PageResult } from '../../common/api/api-response';
import type { Env } from '../../common/config/env.validation';
import { CredentialsCipher } from '../../common/crypto/credentials-cipher';
import { PrismaService, PrismaTx } from '../../common/database/prisma.service';
import { toJsonInput } from '../../common/database/json';
import { Errors } from '../../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthTypeName, ProviderCredentials, ProviderRuntimeConfig } from '../adapters/ports/provider-adapter.port';
import {
  CreateProviderDto, ListProvidersQueryDto, ProviderConfigDto, ServiceCapabilityDto, UpdateProviderDto,
} from './dto/providers.dto';
import { isValidHeaderName, missingCredentialFields } from './provider-auth.util';
import { ProviderUrlError, validateProviderUrl } from './provider-url.util';

type ProviderRow = Prisma.ProviderGetPayload<{ include: { ProviderConfigByProviderId: true; providerServicesByProviderId: true } }>;

const aad = (providerId: string) => `provider:${providerId}`;

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialsCipher,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private readonly include = {
    ProviderConfigByProviderId: true,
    providerServicesByProviderId: true,
  } as const;

  /** Vista segura: jamas incluye credentialsEnc ni credenciales en claro. */
  private toView(p: ProviderRow) {
    const c = p.ProviderConfigByProviderId;
    let credentialFields: string[] = [];
    if (c?.credentialsEnc) {
      try {
        credentialFields = Object.keys(this.cipher.decryptJson<Record<string, string>>(c.credentialsEnc, aad(p.id)));
      } catch {
        credentialFields = [];
      }
    }
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      active: p.active,
      description: p.description,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      config: c && {
        baseUrl: c.baseUrl,
        authType: c.authType,
        authHeaderName: c.authHeaderName,
        hasCredentials: !!c.credentialsEnc,
        credentialFields,
        timeoutMs: c.timeoutMs,
        maxRetries: c.maxRetries,
        retryBaseMs: c.retryBaseMs,
        retryMaxMs: c.retryMaxMs,
        cbFailureThreshold: c.cbFailureThreshold,
        cbResetTimeoutMs: c.cbResetTimeoutMs,
        cbHalfOpenMaxCalls: c.cbHalfOpenMaxCalls,
        supportsIdempotency: c.supportsIdempotency,
        params: c.params,
        updatedAt: c.updatedAt,
      },
      services: p.providerServicesByProviderId.map((s) => ({
        serviceType: s.serviceType,
        canSearch: s.canSearch,
        canHold: s.canHold,
        canConfirm: s.canConfirm,
        canCancel: s.canCancel,
        canQueryStatus: s.canQueryStatus,
      })),
    };
  }

  async list(q: ListProvidersQueryDto): Promise<PageResult<ReturnType<ProvidersService['toView']>>> {
    const where: Prisma.ProviderWhereInput = {
      ...(q.type && { type: q.type }),
      ...(q.active !== undefined && { active: q.active }),
      ...(q.search && {
        OR: [
          { code: { contains: q.search, mode: 'insensitive' } },
          { name: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.provider.findMany({ where, include: this.include, orderBy: { name: 'asc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.provider.count({ where }),
    ]);
    return new PageResult(rows.map((r) => this.toView(r)), total, q.page, q.pageSize);
  }

  async get(id: string) {
    return this.toView(await this.require(id));
  }

  async create(dto: CreateProviderDto) {
    if (await this.prisma.provider.findUnique({ where: { code: dto.code }, select: { id: true } })) {
      throw Errors.conflict('PROVIDER_CODE_IN_USE', 'Ya existe un proveedor con ese codigo');
    }
    const id = randomUUID(); // necesario antes de insertar: el id forma parte del contexto (AAD) del cifrado
    const configData = dto.config ? this.buildConfigData(id, dto.config, null) : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.provider.create({
        data: { id, code: dto.code, name: dto.name, type: dto.type, description: dto.description ?? null },
      });
      if (configData) await tx.providerConfig.create({ data: { providerId: id, ...configData } });
      if (dto.services?.length) await tx.providerService.createMany({ data: dto.services.map((s) => this.serviceRow(id, s)) });

      const created = await this.requireTx(tx, id);
      const view = this.toView(created);
      await this.audit.record({ action: 'PROVIDER_CREATED', entity: 'provider', entityId: id, after: view }, tx);
      return view;
    });
  }

  async update(id: string, dto: UpdateProviderDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireTx(tx, id);
      await tx.provider.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.active !== undefined && { active: dto.active }),
        },
      });
      // Un proveedor inactivo no puede tener integraciones habilitadas.
      if (dto.active === false) await tx.integration.updateMany({ where: { providerId: id, enabled: true }, data: { enabled: false } });

      const updated = await this.requireTx(tx, id);
      await this.audit.record(
        { action: dto.active !== undefined && dto.active !== current.active ? (dto.active ? 'PROVIDER_ACTIVATED' : 'PROVIDER_DEACTIVATED') : 'PROVIDER_UPDATED', entity: 'provider', entityId: id, before: this.toView(current), after: this.toView(updated) },
        tx,
      );
      return this.toView(updated);
    });
  }

  async upsertConfig(id: string, dto: ProviderConfigDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireTx(tx, id);
      const existing = current.ProviderConfigByProviderId;
      const data = this.buildConfigData(id, dto, existing?.credentialsEnc ?? null);
      await tx.providerConfig.upsert({ where: { providerId: id }, create: { providerId: id, ...data }, update: data });

      const updated = await this.requireTx(tx, id);
      await this.audit.record(
        { action: 'PROVIDER_CONFIG_UPDATED', entity: 'provider', entityId: id, before: this.toView(current).config, after: this.toView(updated).config },
        tx,
      );
      return this.toView(updated);
    });
  }

  async setServices(id: string, services: ServiceCapabilityDto[]) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireTx(tx, id);
      await tx.providerService.deleteMany({ where: { providerId: id } });
      if (services.length) await tx.providerService.createMany({ data: services.map((s) => this.serviceRow(id, s)) });
      const updated = await this.requireTx(tx, id);
      await this.audit.record(
        { action: 'PROVIDER_SERVICES_UPDATED', entity: 'provider', entityId: id, before: this.toView(current).services, after: this.toView(updated).services },
        tx,
      );
      return this.toView(updated);
    });
  }

  /**
   * Eliminacion solo si el proveedor no tiene historia. Con transacciones, reservas o catalogo asociado se
   * debe desactivar: la trazabilidad no se destruye.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    const current = await this.require(id);
    const [transactions, products, exceptions] = await Promise.all([
      this.prisma.integrationTransaction.count({ where: { providerId: id } }),
      this.prisma.product.count({ where: { providerId: id } }),
      this.prisma.exceptionCase.count({ where: { providerId: id } }),
    ]);
    if (transactions + products + exceptions > 0) {
      throw Errors.conflict('PROVIDER_HAS_HISTORY', 'El proveedor tiene historial asociado (transacciones, productos o excepciones). Desactivelo en lugar de eliminarlo', {
        transactions, products, exceptions,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.provider.delete({ where: { id } });
      await this.audit.record({ action: 'PROVIDER_DELETED', entity: 'provider', entityId: id, before: this.toView(current) }, tx);
    });
    return { deleted: true };
  }

  /** Configuracion descifrada, solo en memoria, para uso interno del motor de integracion. */
  async getRuntimeConfig(providerId: string): Promise<ProviderRuntimeConfig> {
    const p = await this.require(providerId);
    const c = p.ProviderConfigByProviderId;
    if (!c) throw Errors.unprocessable('PROVIDER_NOT_CONFIGURED', 'El proveedor no tiene ficha tecnica de conexion');
    return {
      providerId: p.id,
      providerCode: p.code,
      providerType: p.type,
      baseUrl: c.baseUrl,
      authType: c.authType as AuthTypeName,
      authHeaderName: c.authHeaderName ?? undefined,
      credentials: c.credentialsEnc ? this.cipher.decryptJson<ProviderCredentials>(c.credentialsEnc, aad(p.id)) : null,
      timeoutMs: c.timeoutMs,
      maxRetries: c.maxRetries,
      retryBaseMs: c.retryBaseMs,
      retryMaxMs: c.retryMaxMs,
      circuitBreaker: { failureThreshold: c.cbFailureThreshold, resetTimeoutMs: c.cbResetTimeoutMs, halfOpenMaxCalls: c.cbHalfOpenMaxCalls },
      supportsIdempotency: c.supportsIdempotency,
      params: (c.params ?? {}) as Record<string, unknown>,
    };
  }

  // ---- internos ----

  private buildConfigData(providerId: string, dto: ProviderConfigDto, existingEnc: string | null) {
    let baseUrl: string;
    try {
      baseUrl = validateProviderUrl(dto.baseUrl, this.config.get('ALLOW_INSECURE_PROVIDER_URLS'));
    } catch (e) {
      if (e instanceof ProviderUrlError) throw Errors.badRequest('INVALID_PROVIDER_URL', e.message);
      throw e;
    }
    if (dto.authHeaderName && !isValidHeaderName(dto.authHeaderName)) {
      throw Errors.badRequest('INVALID_AUTH_HEADER', 'El nombre de cabecera de autenticacion no es valido');
    }
    const retryBase = dto.retryBaseMs ?? 200;
    const retryMax = dto.retryMaxMs ?? 5000;
    if (retryMax < retryBase) throw Errors.badRequest('INVALID_RETRY_CONFIG', 'retryMaxMs debe ser mayor o igual a retryBaseMs');

    // Credenciales: si llegan reemplazan a las anteriores; si no, se conservan (siempre que sigan siendo validas).
    let credentials: ProviderCredentials | null = null;
    let credentialsEnc: string | null = null;
    if (dto.credentials && Object.values(dto.credentials).some((v) => v !== undefined && v !== '')) {
      credentials = Object.fromEntries(Object.entries(dto.credentials).filter(([, v]) => v !== undefined && v !== '')) as ProviderCredentials;
    } else if (existingEnc) {
      credentials = this.cipher.decryptJson<ProviderCredentials>(existingEnc, aad(providerId));
    }
    const missing = missingCredentialFields(dto.authType, credentials);
    if (missing.length) {
      throw Errors.badRequest('MISSING_CREDENTIALS', `Faltan credenciales para ${dto.authType}: ${missing.join(', ')}`, { missing });
    }
    if (dto.authType === 'NONE') credentials = null;
    if (credentials) credentialsEnc = this.cipher.encryptJson(credentials, aad(providerId));

    return {
      baseUrl,
      authType: dto.authType,
      authHeaderName: dto.authHeaderName ?? null,
      credentialsEnc,
      timeoutMs: dto.timeoutMs ?? 8000,
      maxRetries: dto.maxRetries ?? 3,
      retryBaseMs: retryBase,
      retryMaxMs: retryMax,
      cbFailureThreshold: dto.cbFailureThreshold ?? 5,
      cbResetTimeoutMs: dto.cbResetTimeoutMs ?? 30000,
      cbHalfOpenMaxCalls: dto.cbHalfOpenMaxCalls ?? 1,
      supportsIdempotency: dto.supportsIdempotency ?? false,
      params: toJsonInput(dto.params ?? {}) as Prisma.InputJsonValue,
    };
  }

  private serviceRow(providerId: string, s: ServiceCapabilityDto) {
    return {
      providerId,
      serviceType: s.serviceType,
      canSearch: s.canSearch ?? true,
      canHold: s.canHold ?? false,
      canConfirm: s.canConfirm ?? true,
      canCancel: s.canCancel ?? true,
      canQueryStatus: s.canQueryStatus ?? true,
    };
  }

  private async require(id: string): Promise<ProviderRow> {
    const row = await this.prisma.provider.findUnique({ where: { id }, include: this.include });
    if (!row) throw Errors.notFound('PROVIDER_NOT_FOUND', 'Proveedor no encontrado');
    return row;
  }

  private async requireTx(tx: PrismaTx, id: string): Promise<ProviderRow> {
    const row = await tx.provider.findUnique({ where: { id }, include: this.include });
    if (!row) throw Errors.notFound('PROVIDER_NOT_FOUND', 'Proveedor no encontrado');
    return row;
  }
}
