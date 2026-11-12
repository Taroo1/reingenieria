import { Injectable } from '@nestjs/common';
import {
  AvailabilityResult, CancelResult, ConfirmResult, HoldResult, QueryBookingResult, RateResult,
} from '../../normalization/canonical';
import { adapterError, fail } from '../adapter-errors';
import { AdapterResult, HealthCheckData, ProviderAdapter } from '../ports/provider-adapter.port';

/** Codigo de proveedor con el que se marca "Boomi sin conexion real" (lo usa el health-check para informar UNKNOWN). */
export const BOOMI_NOT_CONNECTED = 'BOOMI_NOT_CONNECTED';

export const BOOMI_NOT_CONNECTED_MESSAGE =
  'Boomi preparado pero sin conexion real: requiere credenciales, licencia y documentacion oficial';

/**
 * Adaptador Boomi: PREPARADO, SIN CONEXION REAL.
 *
 * Implementa el puerto completo para que el registro de adaptadores, la configuracion del proveedor,
 * la trazabilidad y la regla de habilitacion ya funcionen con Boomi. No se inventa ningun endpoint,
 * formato ni autenticacion de Boomi: cada operacion responde UNAVAILABLE, no reintentable y con
 * resultado conocido (nada se envio). La integracion no puede habilitarse (IntegrationsService) hasta
 * que exista la conexion real con credenciales, licencia y documentacion oficial.
 */
@Injectable()
export class BoomiAdapter implements ProviderAdapter {
  readonly kind = 'BOOMI' as const;

  private notConnected<T>(): Promise<AdapterResult<T>> {
    return Promise.resolve(fail<T>(adapterError('UNAVAILABLE', BOOMI_NOT_CONNECTED_MESSAGE, { providerCode: BOOMI_NOT_CONNECTED })));
  }

  healthCheck(): Promise<AdapterResult<HealthCheckData>> {
    return this.notConnected();
  }
  searchAvailability(): Promise<AdapterResult<AvailabilityResult>> {
    return this.notConnected();
  }
  getRates(): Promise<AdapterResult<RateResult>> {
    return this.notConnected();
  }
  hold(): Promise<AdapterResult<HoldResult>> {
    return this.notConnected();
  }
  confirm(): Promise<AdapterResult<ConfirmResult>> {
    return this.notConnected();
  }
  cancel(): Promise<AdapterResult<CancelResult>> {
    return this.notConnected();
  }
  queryBooking(): Promise<AdapterResult<QueryBookingResult>> {
    return this.notConnected();
  }
}
