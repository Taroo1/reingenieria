import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../common/config/env.validation';
import { runWithContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/database/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { SystemLogService } from '../audit/system-log.service';
import { BookingsService } from '../bookings/bookings.service';
import { QuotesService } from '../quotes/quotes.service';
import { SyncKindName } from '../sync/dto/sync.dto';
import { SyncService } from '../sync/sync.service';

const EXPIRY_INTERVAL_MS = 30_000;
/** Un item recien enviado no se concilia enseguida: se le da tiempo al proveedor. */
const RECONCILE_MIN_AGE_MS = 5_000;
/** El catalogo cambia poco: se sincroniza cada CATALOG_EVERY ciclos de sincronizacion. */
const CATALOG_EVERY = 24;

/**
 * Planificador en proceso (sin Redis, decision de la Etapa 3). Seguro con varias replicas:
 *  - vencimientos y conciliacion son idempotentes (UPDATE condicionales sobre el estado);
 *  - la sincronizacion toma un lease por (tipo, integracion) con advisory lock de Postgres.
 * Cada trabajo corre con su propio correlationId y nunca se superpone consigo mismo en el proceso.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  private syncCycle = 0;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly quotes: QuotesService,
    private readonly sync: SyncService,
    private readonly systemLog: SystemLogService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOBS_ENABLED', { infer: true })) {
      this.logger.log('Planificador deshabilitado (JOBS_ENABLED=false)');
      return;
    }
    this.every('expiry', EXPIRY_INTERVAL_MS, () => this.expiry());
    this.every('reconcile', this.config.get('RECONCILE_INTERVAL_SECONDS', { infer: true }) * 1000, () => this.reconcile());
    this.every('sync', this.config.get('SYNC_INTERVAL_MINUTES', { infer: true }) * 60_000, () => this.syncAll());
    this.logger.log('Planificador iniciado: vencimientos, conciliacion y sincronizacion');
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  private every(name: string, ms: number, fn: () => Promise<void>): void {
    const t = setInterval(() => void this.runJob(name, fn), ms);
    t.unref();
    this.timers.push(t);
  }

  /** Ejecuta un trabajo con su contexto; nunca dos ejecuciones simultaneas del mismo trabajo en el proceso. */
  async runJob(name: string, fn: () => Promise<void>): Promise<void> {
    if (this.running.has(name)) return;
    this.running.add(name);
    try {
      await runWithContext({ correlationId: `job-${name}-${Date.now()}` }, fn);
    } catch (e) {
      this.logger.error(`Trabajo ${name} fallo: ${(e as Error).message}`);
      await this.systemLog.write('ERROR', `job:${name}`, `El trabajo ${name} fallo: ${(e as Error).message}`);
    } finally {
      this.running.delete(name);
    }
  }

  async expiry(): Promise<void> {
    const r = await this.bookings.expireDue();
    const quotes = await this.quotes.expireStale();
    const keys = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (r.expiredHeld + r.expiredQuoted + r.orphanHolds + quotes > 0) {
      await this.systemLog.write('INFO', 'job:expiry', 'Vencimientos aplicados', { ...r, expiredQuotes: quotes, idempotencyKeysPurged: keys.count });
    }
  }

  async reconcile(): Promise<void> {
    const items = await this.bookings.pendingItems(RECONCILE_MIN_AGE_MS);
    for (const i of items) {
      try {
        await this.bookings.reconcileItem(i.id);
      } catch (e) {
        // Otra replica o una accion manual avanzo la reserva: no es un error.
        if (!(e instanceof AppException && e.code === 'INVALID_BOOKING_STATE')) throw e;
      }
    }
  }

  async syncAll(): Promise<void> {
    this.syncCycle++;
    const kinds: SyncKindName[] = ['AVAILABILITY', 'RATES', 'BOOKINGS'];
    if (this.syncCycle % CATALOG_EVERY === 1) kinds.unshift('CATALOG');
    const integrations = await this.prisma.integration.findMany({ where: { enabled: true, provider: { active: true } }, select: { id: true } });
    for (const i of integrations) {
      for (const kind of kinds) {
        try {
          await this.sync.run(kind, i.id);
        } catch (e) {
          if (e instanceof AppException && (e.code === 'SYNC_IN_PROGRESS' || e.code === 'INTEGRATION_DISABLED')) continue;
          throw e;
        }
      }
    }
  }
}
