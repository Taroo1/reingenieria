'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { failedCalls, issueLevel, IntegrationsTable } from '@/components/integrations-table';
import { Icon } from '@/components/icons';
import {
  Button, ButtonLink, Callout, Card, EmptyState, ErrorBox, PageHeader, Severity, Skeleton, StatCard, StatusBadge, ToneBadge, useToast,
} from '@/components/ui';
import { api } from '@/lib/client/api';
import { canOperate, useUser } from '@/lib/client/session';
import { ALERT_KIND, BOOKING, BOOKING_ATTENTION, SEVERITY, SEVERITY_ORDER, SYNC_STATUS } from '@/lib/client/status';
import { AlertRow, Overview } from '@/lib/client/types';
import { errorText, fmtDateShort, fmtInt, fmtRelative, useLoad } from '@/lib/client/ui';

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const REFRESH_MS = 60_000;
const SYNC_KIND: Record<string, string> = { AVAILABILITY: 'Disponibilidad', RATES: 'Tarifas', BOOKINGS: 'Reservas', CATALOG: 'Catalogo' };
const BOOKING_ORDER = ['REQUIRES_REVIEW', 'FAILED', 'PENDING_CONFIRMATION', 'COMPENSATING', 'CANCEL_REQUESTED', 'HELD', 'QUOTED', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'DRAFT'];

function SeverityChips({ counts }: { counts: Record<string, number> }) {
  const present = SEVERITY_ORDER.filter((s) => counts[s]);
  if (!present.length) return <span>Sin casos abiertos</span>;
  return <>{present.map((s) => <ToneBadge key={s} tone={SEVERITY[s]!.tone} dot>{counts[s]} {SEVERITY[s]!.label.toLowerCase()}</ToneBadge>)}</>;
}

export default function PanelPage() {
  const user = useUser();
  const toast = useToast();
  const op = canOperate(user);
  const overview = useLoad(() => api.get<Overview>('monitoring/overview').then((r) => r.data), []);
  const alerts = useLoad(() => api.get<AlertRow[]>('alerts?status=OPEN&pageSize=6'), []);
  const [acting, setActing] = useState<string | null>(null);
  const [showAllSync, setShowAllSync] = useState(false);

  const refresh = () => { overview.reload(); alerts.reload(); };
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function alertAction(a: AlertRow, action: 'acknowledge' | 'resolve') {
    setActing(a.id);
    try {
      await api.post(`alerts/${a.id}/${action}`);
      toast({ tone: 'ok', title: action === 'acknowledge' ? 'Alerta reconocida' : 'Alerta resuelta', body: a.message });
      refresh();
    } catch (e) {
      toast({ tone: 'bad', title: 'No se pudo actualizar la alerta', body: errorText(e) });
    } finally {
      setActing(null);
    }
  }

  const d = overview.data;
  const m = useMemo(() => {
    if (!d) return null;
    const enabled = d.integrations.filter((i) => i.enabled);
    const calls = d.integrations.reduce((a, i) => a + i.last24h.calls, 0);
    const failed = d.integrations.reduce((a, i) => a + failedCalls(i), 0);
    const agg = d.integrations.reduce((a, i) => ({ failed: a.failed + i.last24h.failed, timeout: a.timeout + i.last24h.timeout, rejected: a.rejected + i.last24h.rejected, sc: a.sc + i.last24h.shortCircuited }), { failed: 0, timeout: 0, rejected: 0, sc: 0 });
    const issues = enabled.filter((i) => issueLevel(i));
    const bad = issues.filter((i) => issueLevel(i) === 'bad');
    const count = (s: string) => enabled.filter((i) => i.status === s).length;
    const attention = BOOKING_ATTENTION.reduce((a, s) => a + (d.bookingsByStatus[s] ?? 0), 0);
    return { enabled, calls, failed, agg, issues, bad, healthy: count('HEALTHY'), degraded: count('DEGRADED'), down: count('DOWN'), unknown: count('UNKNOWN'), attention };
  }, [d]);

  const integrationName = (id: string | null) => (id && d?.integrations.find((i) => i.id === id)?.name) || '—';
  const alertTotal = alerts.data?.meta.total ?? alerts.data?.data.length ?? 0;
  const alertsOpen = d ? sum(d.alertsOpenBySeverity) : 0;
  const excOpen = d ? sum(d.exceptionsOpenBySeverity) : 0;

  return (
    <>
      <PageHeader
        title="Panel de operaciones"
        description="Salud de las integraciones, alertas y reservas que requieren atencion. Metricas de llamadas de las ultimas 24 horas."
        actions={<>
          {d && <span className="muted small" aria-live="polite">Actualizado {new Date(d.generatedAt).toLocaleTimeString('es-AR')} · cada 60 s</span>}
          <Button icon="refresh" onClick={refresh} loading={overview.loading && !!d}>Actualizar</Button>
        </>}
      />
      <ErrorBox error={overview.error} title="No se pudo cargar el panel" />

      {/* Estado general */}
      {m && (
        m.bad.length > 0 ? (
          <Callout tone="bad" title={`${m.bad.length} integracion${m.bad.length === 1 ? '' : 'es'} habilitada${m.bad.length === 1 ? '' : 's'} con fallas`}>
            {m.bad.map((i) => i.name).join(', ')}. Revisa la tabla de integraciones para ver el ultimo error y el estado del circuito.
          </Callout>
        ) : m.issues.length > 0 ? (
          <Callout tone="warn" title={`${m.issues.length} integracion${m.issues.length === 1 ? '' : 'es'} con funcionamiento degradado`}>{m.issues.map((i) => i.name).join(', ')}.</Callout>
        ) : m.enabled.length > 0 && m.unknown === 0 ? (
          <Callout tone="ok" title="Operacion normal">Todas las integraciones habilitadas reportan estado saludable.</Callout>
        ) : m.unknown > 0 ? (
          <Callout tone="info" title="Estado parcial">{m.unknown} integracion{m.unknown === 1 ? '' : 'es'} habilitada{m.unknown === 1 ? '' : 's'} sin datos de salud todavia. Ninguna reporta fallas.</Callout>
        ) : null
      )}

      {/* KPIs */}
      <div className="kpi-grid">
        {!d || !m ? Array.from({ length: 4 }, (_, i) => <div key={i} className="stat"><Skeleton h={14} w="55%" /><Skeleton h={30} w="35%" /><Skeleton h={12} w="80%" /></div>) : (
          <>
            <StatCard
              label="Integraciones saludables" icon="plug" href="#integraciones"
              tone={m.bad.length ? 'bad' : m.issues.length ? 'warn' : 'ok'}
              value={m.healthy} suffix={`de ${m.enabled.length} habilitadas`}
              hint="Ir a la tabla de integraciones"
              foot={<>
                {m.down > 0 && <ToneBadge tone="bad">{m.down} caida{m.down === 1 ? '' : 's'}</ToneBadge>}
                {m.degraded > 0 && <ToneBadge tone="warn">{m.degraded} degradada{m.degraded === 1 ? '' : 's'}</ToneBadge>}
                {m.unknown > 0 && <ToneBadge tone="neutral">{m.unknown} sin datos</ToneBadge>}
                {m.down + m.degraded + m.unknown === 0 && <span>Sin incidencias</span>}
              </>}
            />
            <StatCard
              label="Llamadas fallidas (24 h)" icon="activity" href="#integraciones" tone={m.failed > 0 ? 'bad' : 'ok'}
              value={fmtInt(m.failed)} suffix={`de ${fmtInt(m.calls)}`}
              hint="Ir a la tabla de integraciones"
              foot={m.calls === 0 ? <span>Sin llamadas en la ventana</span> : <span title="Error · Timeout · Rechazadas · Cortadas por el circuito">Error {m.agg.failed} · Timeout {m.agg.timeout} · Rechaz. {m.agg.rejected} · Circ. {m.agg.sc}</span>}
            />
            <StatCard label="Alertas abiertas" icon="bell" href="/alerts" tone={alertsOpen ? 'warn' : 'ok'} value={alertsOpen} hint="Ver alertas" foot={<SeverityChips counts={d.alertsOpenBySeverity} />} />
            <StatCard label="Excepciones abiertas" icon="exceptions" href="/exceptions" tone={excOpen ? 'warn' : 'ok'} value={excOpen} hint="Ver excepciones" foot={<SeverityChips counts={d.exceptionsOpenBySeverity} />} />
          </>
        )}
      </div>

      {/* Atencion: alertas + reservas */}
      <div className="split section">
        <Card
          title="Alertas que requieren intervencion" sub="Abiertas, mas recientes primero" busy={alerts.loading && !!alerts.data}
          actions={<ButtonLink href="/alerts" size="sm" variant="ghost">Ver todas <Icon name="arrowRight" size={14} /></ButtonLink>}
          footer={alertTotal > 6 ? <span className="muted small">Mostrando 6 de {alertTotal} alertas abiertas</span> : undefined}
        >
          <ErrorBox error={alerts.error} title="No se pudieron cargar las alertas" />
          {!alerts.data && !alerts.error && <div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={36} />)}</div>}
          {alerts.data && alerts.data.data.length === 0 && (
            <EmptyState icon="checkCircle" tone="ok" title="No hay alertas abiertas" compact>Ninguna alerta espera intervencion en este momento.</EmptyState>
          )}
          {alerts.data && alerts.data.data.length > 0 && (
            <ul className="list">
              {alerts.data.data.map((a) => (
                <li key={a.id} className="list-item">
                  <Severity value={a.severity} dict={SEVERITY} />
                  <div className="li-main">
                    <div className="li-title">{a.message}</div>
                    <div className="li-meta">
                      <StatusBadge dict={ALERT_KIND} value={a.kind} />
                      {a.integration && <span>{a.integration.name}</span>}
                      {a.provider && <span className="mono">{a.provider.code}</span>}
                      <span title={new Date(a.createdAt).toLocaleString('es-AR')}>{fmtRelative(a.createdAt)}</span>
                    </div>
                  </div>
                  {op && (
                    <div className="li-side">
                      <Button size="sm" onClick={() => alertAction(a, 'acknowledge')} disabled={acting === a.id}>Reconocer</Button>
                      <Button size="sm" variant="ghost" onClick={() => alertAction(a, 'resolve')} disabled={acting === a.id}>Resolver</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Reservas por estado" sub={m ? (m.attention > 0 ? `${m.attention} requieren atencion` : 'Ninguna requiere atencion') : undefined}
          actions={<ButtonLink href="/bookings" size="sm" variant="ghost">Ver reservas <Icon name="arrowRight" size={14} /></ButtonLink>}
        >
          {!d ? <div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={28} />)}</div> : Object.keys(d.bookingsByStatus).length === 0 ? (
            <EmptyState icon="bookings" title="Todavia no hay reservas" compact />
          ) : (
            <ul className="list">
              {BOOKING_ORDER.filter((s) => d.bookingsByStatus[s] !== undefined)
                .concat(Object.keys(d.bookingsByStatus).filter((s) => !BOOKING_ORDER.includes(s)))
                .map((s) => {
                  const attn = BOOKING_ATTENTION.includes(s);
                  return (
                    <li key={s}>
                      <Link href={`/bookings?status=${s}`} className="list-item" style={{ alignItems: 'center', padding: '10px 20px' }}>
                        <div className="li-main row" style={{ gap: 10 }}>
                          <StatusBadge dict={BOOKING} value={s} tip={false} />
                          {attn && <span className="small warn-text">Requiere atencion</span>}
                        </div>
                        <span className="num strong" style={{ fontSize: 'var(--fs-lg)' }}>{fmtInt(d.bookingsByStatus[s])}</span>
                        <Icon name="chevronRight" size={14} className="muted" />
                      </Link>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      </div>

      {/* Integraciones */}
      <section id="integraciones" className="section" style={{ scrollMarginTop: 24 }}>
        <Card
          title="Integraciones" sub="Salud y circuit breaker son dimensiones independientes · llamadas, exito y latencia de las ultimas 24 h (sin health-checks)"
          busy={overview.loading && !!d}
        >
          {!d ? (
            <div className="card-body stack">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={34} />)}</div>
          ) : (
            <IntegrationsTable rows={d.integrations} />
          )}
        </Card>
      </section>

      {/* Actividad de sincronizacion */}
      {d?.recentSyncRuns && (
        <section className="section">
          <Card
            title="Sincronizaciones recientes" sub={`Ultimas ${d.recentSyncRuns.length} ejecuciones registradas`}
            footer={d.recentSyncRuns.length > 8 ? (
              <Button size="sm" variant="ghost" icon={showAllSync ? 'chevronDown' : 'chevronRight'} aria-expanded={showAllSync} onClick={() => setShowAllSync(!showAllSync)}>
                {showAllSync ? 'Mostrar menos' : `Mostrar las ${d.recentSyncRuns.length}`}
              </Button>
            ) : undefined}
          >
            {d.recentSyncRuns.length === 0 ? (
              <EmptyState icon="sync" title="Sin sincronizaciones registradas" compact>Cuando el planificador o un operador ejecute una sincronizacion, aparecera aqui.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Tipo</th><th>Integracion</th><th>Estado</th><th>Inicio</th><th className="r">Procesados</th><th className="r">Cambios</th><th className="r">Inconsistencias</th></tr></thead>
                  <tbody>
                    {(showAllSync ? d.recentSyncRuns : d.recentSyncRuns.slice(0, 8)).map((s) => (
                      <tr key={s.id}>
                        <td className="primary">{SYNC_KIND[s.kind] ?? s.kind}</td>
                        <td>{integrationName(s.integrationId)}</td>
                        <td><StatusBadge dict={SYNC_STATUS} value={s.status} /></td>
                        <td className="nowrap" title={new Date(s.startedAt).toLocaleString('es-AR')}>{fmtDateShort(s.startedAt)}</td>
                        <td className="r">{fmtInt(s.itemsProcessed)}</td>
                        <td className="r">{fmtInt(s.itemsChanged)}</td>
                        <td className={`r ${s.inconsistenciesFound > 0 ? 'warn-text strong' : ''}`}>{fmtInt(s.inconsistenciesFound)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      )}
    </>
  );
}
