'use client';
import { useMemo, useState } from 'react';
import { CIRCUIT, CIRCUIT_NONE, HEALTH } from '@/lib/client/status';
import { OverviewIntegration } from '@/lib/client/types';
import { fmtInt, fmtRelative, useSort } from '@/lib/client/ui';
import { IconName } from './icons';
import { EmptyState, HelpTip, SearchInput, Segmented, SortTh, StatusBadge, Tip, ToneBadge } from './ui';

type View = 'all' | 'issues' | 'enabled' | 'disabled';
type SortKey = 'name' | 'provider' | 'health' | 'calls' | 'failed' | 'rate' | 'p95';

const CIRCUIT_ICON: Record<string, IconName> = { CLOSED: 'circuitClosed', OPEN: 'circuitOpen', HALF_OPEN: 'circuitHalf' };
const HEALTH_RANK: Record<string, number> = { DOWN: 0, DEGRADED: 1, UNKNOWN: 2, HEALTHY: 3 };

export const failedCalls = (i: OverviewIntegration) => i.last24h.calls - i.last24h.success;

/** Problema = dato real del backend: salud DOWN/DEGRADED o circuito OPEN/HALF_OPEN. */
export function issueLevel(i: OverviewIntegration): 'bad' | 'warn' | null {
  if (i.status === 'DOWN' || i.circuit?.state === 'OPEN') return 'bad';
  if (i.status === 'DEGRADED' || i.circuit?.state === 'HALF_OPEN') return 'warn';
  return null;
}

function CircuitCell({ c }: { c: OverviewIntegration['circuit'] }) {
  if (!c) {
    return (
      <Tip content={<><strong>{CIRCUIT_NONE.label}</strong>{CIRCUIT_NONE.desc}</>}>
        <ToneBadge tone="neutral" outline icon="circuitNone">{CIRCUIT_NONE.label}</ToneBadge>
      </Tip>
    );
  }
  return (
    <>
      <StatusBadge dict={CIRCUIT} value={c.state} outline icon={CIRCUIT_ICON[c.state] ?? 'circuitNone'} />
      <div className="secondary">
        {c.failureCount > 0 ? `${c.failureCount} falla${c.failureCount === 1 ? '' : 's'} registradas` : 'Sin fallas registradas'}
        {c.state !== 'CLOSED' && c.nextAttemptAt && <> · reintento {fmtRelative(c.nextAttemptAt)}</>}
      </div>
    </>
  );
}

function FailedCell({ i }: { i: OverviewIntegration }) {
  const f = failedCalls(i);
  if (i.last24h.calls === 0) return <span className="muted">—</span>;
  const s = i.last24h;
  return (
    <Tip content={<><strong>Llamadas no exitosas (24 h)</strong>Error: {s.failed} · Timeout: {s.timeout} · Rechazadas: {s.rejected} · Cortadas por el circuito: {s.shortCircuited}</>}>
      <span className={f > 0 ? 'bad-text strong' : 'muted'}>{fmtInt(f)} fallida{f === 1 ? '' : 's'}</span>
    </Tip>
  );
}

function RateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="muted">—</span>;
  const tone = rate >= 98 ? '' : rate >= 90 ? 'warn' : 'bad';
  return (
    <span className="meter">
      <span className="num">{rate.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%</span>
      <span className="meter-track" aria-hidden="true"><span className={`meter-fill ${tone}`} style={{ width: `${Math.max(2, rate)}%` }} /></span>
    </span>
  );
}

export function IntegrationsTable({ rows }: { rows: OverviewIntegration[] }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('all');
  const [provider, setProvider] = useState('');
  const [health, setHealth] = useState('');
  const [circuit, setCircuit] = useState('');

  const providers = useMemo(() => [...new Map(rows.map((r) => [r.provider.code, r.provider])).values()].sort((a, b) => a.code.localeCompare(b.code)), [rows]);
  const issues = rows.filter((r) => issueLevel(r)).length;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (view === 'issues' && !issueLevel(r)) return false;
      if (view === 'enabled' && !r.enabled) return false;
      if (view === 'disabled' && r.enabled) return false;
      if (provider && r.provider.code !== provider) return false;
      if (health && r.status !== health) return false;
      if (circuit && (circuit === 'NONE' ? r.circuit !== null : r.circuit?.state !== circuit)) return false;
      if (term && ![r.name, r.provider.code, r.provider.name, r.adapterKind].some((v) => v.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [rows, q, view, provider, health, circuit]);

  const { sorted, sort, toggle } = useSort<OverviewIntegration, SortKey>(filtered, { key: 'health', dir: 'asc' }, {
    name: (r) => r.name,
    provider: (r) => r.provider.code,
    health: (r) => (HEALTH_RANK[r.status] ?? 9) * 10 + (r.enabled ? 0 : 5),
    calls: (r) => r.last24h.calls,
    failed: (r) => (r.last24h.calls ? failedCalls(r) : null),
    rate: (r) => r.last24h.successRate,
    p95: (r) => r.last24h.latencyMs.p95,
  });

  const filtersOn = q || provider || health || circuit || view !== 'all';
  const clear = () => { setQ(''); setProvider(''); setHealth(''); setCircuit(''); setView('all'); };

  return (
    <>
      <div className="toolbar">
        <SearchInput className="grow" value={q} onChange={setQ} placeholder="Buscar integracion o proveedor" label="Buscar integraciones" />
        <Segmented<View> label="Vista" value={view} onChange={setView} options={[
          { value: 'all', label: 'Todas' },
          { value: 'issues', label: <>Con problemas{issues > 0 && <span className="bad-text"> · {issues}</span>}</> },
          { value: 'enabled', label: 'Habilitadas' },
          { value: 'disabled', label: 'Deshabilitadas' },
        ]} />
        <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Filtrar por proveedor">
          <option value="">Todos los proveedores</option>
          {providers.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
        </select>
        <select className="select" value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Filtrar por estado de salud">
          <option value="">Salud: todas</option>
          {Object.entries(HEALTH).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" value={circuit} onChange={(e) => setCircuit(e.target.value)} aria-label="Filtrar por estado del circuit breaker">
          <option value="">Circuito: todos</option>
          {Object.entries(CIRCUIT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          <option value="NONE">{CIRCUIT_NONE.label}</option>
        </select>
        {filtersOn && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Limpiar filtros</button>}
        <span className="count" aria-live="polite">{sorted.length} de {rows.length}</span>
      </div>
      <div className="table-wrap tall">
        <table className="table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} onSort={toggle}>Integracion</SortTh>
              <SortTh k="provider" sort={sort} onSort={toggle}>Proveedor</SortTh>
              <SortTh k="health" sort={sort} onSort={toggle}>
                Salud
              </SortTh>
              <th>
                <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>Circuit breaker
                  <HelpTip label="Que es el circuit breaker">
                    <strong>Dimension distinta de la salud</strong>
                    Cerrado deja pasar solicitudes; Abierto las bloquea tras fallas repetidas; Semiabierto deja pasar pruebas. Un circuito cerrado no garantiza que la integracion este saludable.
                  </HelpTip>
                </span>
              </th>
              <SortTh k="calls" sort={sort} onSort={toggle} align="r">Llamadas</SortTh>
              <SortTh k="rate" sort={sort} onSort={toggle} align="r">Exito</SortTh>
              <SortTh k="p95" sort={sort} onSort={toggle} align="r">p50 / p95</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const lvl = issueLevel(i);
              return (
                <tr key={i.id} className={lvl === 'bad' ? 'row-attn' : lvl === 'warn' ? 'row-warn' : undefined}>
                  <td style={{ minWidth: 190 }}>
                    <div className="primary">{i.name}</div>
                    <div className="row secondary" style={{ gap: 6, marginTop: 4 }}>
                      <span className="tag">{i.adapterKind}</span>
                      {!i.enabled && <span className="tag" style={{ color: 'var(--warn)' }}>Deshabilitada</span>}
                    </div>
                  </td>
                  <td style={{ minWidth: 140, maxWidth: 200 }}>
                    <div className="mono primary">{i.provider.code}</div>
                    <div className="secondary truncate" title={i.provider.name}>{i.provider.name}</div>
                  </td>
                  <td style={{ minWidth: 170, maxWidth: 230 }}>
                    <StatusBadge dict={HEALTH} value={i.status} pulse={i.status === 'DOWN' && i.enabled} />
                    <div className="secondary">{i.lastHealthAt ? `Chequeo ${fmtRelative(i.lastHealthAt)}` : 'Sin chequeos registrados'}</div>
                    {i.lastError && <div className="secondary bad-text truncate" title={i.lastError} style={{ maxWidth: 210 }}>{i.lastError}</div>}
                  </td>
                  <td style={{ minWidth: 150 }}><CircuitCell c={i.circuit} /></td>
                  <td className="r nowrap">{fmtInt(i.last24h.calls)}{i.last24h.calls > 0 && <div className="secondary"><FailedCell i={i} /></div>}</td>
                  <td className="r nowrap"><RateCell rate={i.last24h.successRate} /></td>
                  <td className="r nowrap">
                    {i.last24h.latencyMs.p50 === null && i.last24h.latencyMs.p95 === null ? <span className="muted">—</span> : (
                      <><span>{fmtInt(i.last24h.latencyMs.p50)}</span><span className="muted"> / </span><span className="strong">{fmtInt(i.last24h.latencyMs.p95)}</span><span className="muted small"> ms</span></>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <EmptyState icon="filter" title="Ninguna integracion coincide" compact action={filtersOn ? <button type="button" className="btn btn-sm" onClick={clear}>Limpiar filtros</button> : undefined}>
            {rows.length === 0 ? 'No hay integraciones configuradas.' : 'Proba con otros filtros o termino de busqueda.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

