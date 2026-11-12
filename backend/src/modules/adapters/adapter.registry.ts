import { Injectable } from '@nestjs/common';
import { BoomiAdapter } from './boomi/boomi.adapter';
import { HttpProviderAdapter } from './http/http.adapter';
import { AdapterKindName, ProviderAdapter } from './ports/provider-adapter.port';
import { SimulatedAdapter } from './simulated/simulated.adapter';

/** Resuelve la implementacion del puerto segun el tipo de adaptador de la integracion. */
@Injectable()
export class AdapterRegistry {
  private readonly byKind: Record<AdapterKindName, ProviderAdapter>;

  constructor(simulated: SimulatedAdapter, http: HttpProviderAdapter, boomi: BoomiAdapter) {
    this.byKind = { SIMULATED: simulated, HTTP: http, BOOMI: boomi };
  }

  get(kind: AdapterKindName): ProviderAdapter {
    const adapter = this.byKind[kind];
    if (!adapter) throw new Error(`No hay adaptador para el tipo ${String(kind)}`);
    return adapter;
  }
}
