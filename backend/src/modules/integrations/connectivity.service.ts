import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { BOOMI_NOT_CONNECTED } from '../adapters/boomi/boomi.adapter';
import { IntegrationEngine } from '../integration-engine/integration-engine.service';

export type HealthStatusName = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface ConnectivityResult {
  status: HealthStatusName;
  success: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  message: string;
  /** Transaccion de integracion que registro la sonda. */
  transactionId: string | null;
}

/** Timeout por defecto de la ficha tecnica (el mismo que en la base). */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Comprueba la conectividad de una integracion a traves del motor (queda registrada como transaccion
 * HEALTH_CHECK). El adaptador decide como probar:
 *  - SIMULATED: en memoria, sin red.
 *  - HTTP: GET a baseUrl + params.healthPath (por defecto /health) con la autenticacion del proveedor.
 *  - BOOMI: preparado, sin conexion real: se informa UNKNOWN; no se afirma conectividad que no existe.
 */
@Injectable()
export class ConnectivityService {
  constructor(
    private readonly engine: IntegrationEngine,
    private readonly prisma: PrismaService,
  ) {}

  async check(integrationId: string): Promise<ConnectivityResult> {
    const r = await this.engine.healthCheck(integrationId);
    if (r.ok) {
      // Latencia alta: mas de la mitad del timeout configurado para el proveedor.
      const slow = r.data.latencyMs > (await this.timeoutOf(integrationId)) / 2;
      return {
        status: slow ? 'DEGRADED' : 'HEALTHY',
        success: true,
        latencyMs: r.data.latencyMs,
        statusCode: r.httpStatus ?? null,
        message: slow ? 'Responde, pero con latencia alta' : (r.data.detail ?? 'OK'),
        transactionId: r.transactionId,
      };
    }
    if (r.error.providerCode === BOOMI_NOT_CONNECTED) {
      return { status: 'UNKNOWN', success: false, latencyMs: null, statusCode: null, message: r.error.message, transactionId: r.transactionId };
    }
    return {
      status: 'DOWN',
      success: false,
      latencyMs: r.latencyMs,
      statusCode: r.error.httpStatus ?? null,
      message: r.error.message,
      transactionId: r.transactionId,
    };
  }

  private async timeoutOf(integrationId: string): Promise<number> {
    const row = await this.prisma.integration.findUnique({
      where: { id: integrationId },
      select: { provider: { select: { ProviderConfigByProviderId: { select: { timeoutMs: true } } } } },
    });
    return row?.provider.ProviderConfigByProviderId?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }
}
