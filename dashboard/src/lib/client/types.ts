/** Contratos de lectura tal como los devuelve el backend (solo los campos que usa la interfaz). */

export interface OverviewIntegration {
  id: string; name: string; adapterKind: string; enabled: boolean; status: string; lastHealthAt: string | null; lastError: string | null;
  provider: { id: string; code: string; name: string; type: string };
  circuit: { state: string; failureCount: number; openedAt: string | null; nextAttemptAt: string | null } | null;
  last24h: {
    calls: number; success: number; failed: number; timeout: number; rejected: number; shortCircuited: number;
    successRate: number | null; latencyMs: { p50: number | null; p95: number | null };
  };
}

export interface SyncRunRow {
  id: string; kind: string; status: string; integrationId: string | null; startedAt: string; finishedAt: string | null;
  itemsProcessed: number; itemsChanged: number; inconsistenciesFound: number;
}

export interface Overview {
  generatedAt: string;
  window?: { from: string; hours: number };
  integrations: OverviewIntegration[];
  alertsOpenBySeverity: Record<string, number>;
  exceptionsOpenBySeverity: Record<string, number>;
  bookingsByStatus: Record<string, number>;
  recentSyncRuns?: SyncRunRow[];
}

export interface AlertRow {
  id: string; kind: string; severity: string; status: string; message: string; createdAt: string;
  acknowledgedAt: string | null; resolvedAt: string | null;
  integration: { id: string; name: string } | null; provider: { id: string; code: string } | null; acknowledgedBy: { id: string; email: string } | null;
}
