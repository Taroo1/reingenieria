/**
 * CONTRATO CONGELADO (Etapa 2): formato de respuesta y de error de la API.
 * Cualquier cambio exige analizar el impacto en el dashboard y en la plataforma de compra (Propuesta 1).
 */

export interface ApiMeta {
  correlationId: string;
  /** Presente cuando la operacion genero una transaccion de integracion. */
  transactionId?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    /** Codigo estable y legible por maquina, p. ej. PROVIDER_IN_USE. */
    code: string;
    /** Mensaje para el operador. Nunca incluye detalles internos. */
    message: string;
    statusCode: number;
    details?: unknown;
  };
  meta: {
    correlationId: string;
    timestamp: string;
    path: string;
  };
}

/** Resultado paginado: el interceptor lo convierte en { data: items, meta: { page, ... } }. */
export class PageResult<T> {
  constructor(
    public readonly items: T[],
    public readonly total: number,
    public readonly page: number,
    public readonly pageSize: number,
  ) {}
}

/** Respuesta con metadatos adicionales (p. ej. transactionId). */
export class WithMeta<T> {
  constructor(
    public readonly data: T,
    public readonly meta: Partial<ApiMeta>,
  ) {}
}
