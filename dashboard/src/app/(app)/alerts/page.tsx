'use client';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, Segmented, Severity, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { api, Meta, qs } from '@/lib/client/api';
import { canOperate, useUser } from '@/lib/client/session';
import { ALERT_KIND, ALERT_STATUS, SEVERITY } from '@/lib/client/status';
import { AlertRow } from '@/lib/client/types';
import { errorText, fmtDateShort, fmtRelative, useLoad } from '@/lib/client/ui';

type StatusFilter = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | '';
const PAGE_SIZE = 25;

export default function AlertsPage() {
  const user = useUser();
  const op = canOperate(user);
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [severity, setSeverity] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(
    () => api.get<AlertRow[]>(`alerts${qs({ status, severity, kind, page, pageSize: PAGE_SIZE })}`),
    [status, severity, kind, page],
  );
  const meta: Meta = data?.meta ?? {};
  const rows = data?.data ?? [];
  const filtersOn = !!(severity || kind);

  async function act(a: AlertRow, action: 'acknowledge' | 'resolve') {
    setActing(a.id);
    try {
      await api.post(`alerts/${a.id}/${action}`);
      toast({ tone: 'ok', title: action === 'acknowledge' ? 'Alerta reconocida' : 'Alerta resuelta', body: a.message });
      reload();
    } catch (e) {
      toast({ tone: 'bad', title: 'No se pudo actualizar la alerta', body: errorText(e) });
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Senales automaticas del motor de integracion: proveedores caidos, circuitos abiertos, errores y latencia elevados, sincronizaciones fallidas."
        actions={<Button icon="refresh" onClick={reload} loading={loading && !!data}>Actualizar</Button>}
      />
      <Card busy={loading && !!data}>
        <div className="toolbar">
          <Segmented<StatusFilter> label="Estado" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
            { value: 'OPEN', label: 'Abiertas' }, { value: 'ACKNOWLEDGED', label: 'Reconocidas' }, { value: 'RESOLVED', label: 'Resueltas' }, { value: '', label: 'Todas' },
          ]} />
          <select className="select" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label="Filtrar por severidad">
            <option value="">Todas las severidades</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="select" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            {Object.entries(ALERT_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {filtersOn && <Button size="sm" variant="ghost" onClick={() => { setSeverity(''); setKind(''); setPage(1); }}>Limpiar filtros</Button>}
        </div>
        <ErrorBox error={error} title="No se pudieron cargar las alertas" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Severidad</th><th>Alerta</th><th>Tipo</th><th>Origen</th><th>Estado</th><th>Creada</th>{op && <th className="r"><span className="sr-only">Acciones</span></th>}</tr>
            </thead>
            <tbody>
              {!data && !error && <SkeletonRows cols={op ? 7 : 6} />}
              {rows.map((a) => (
                <tr key={a.id} className={a.status === 'OPEN' && (a.severity === 'CRITICAL' || a.severity === 'HIGH') ? 'row-attn' : undefined}>
                  <td className="shrink"><Severity value={a.severity} dict={SEVERITY} /></td>
                  <td style={{ minWidth: 220 }}>
                    <div className="primary">{a.message}</div>
                    {a.acknowledgedBy && <div className="secondary">Reconocida por {a.acknowledgedBy.email} {a.acknowledgedAt && fmtRelative(a.acknowledgedAt)}</div>}
                  </td>
                  <td><StatusBadge dict={ALERT_KIND} value={a.kind} /></td>
                  <td>
                    {a.integration ? <div>{a.integration.name}</div> : null}
                    {a.provider ? <div className="secondary mono">{a.provider.code}</div> : null}
                    {!a.integration && !a.provider && <span className="muted">—</span>}
                  </td>
                  <td><StatusBadge dict={ALERT_STATUS} value={a.status} /></td>
                  <td className="nowrap" title={new Date(a.createdAt).toLocaleString('es-AR')}>
                    {fmtDateShort(a.createdAt)}<div className="secondary">{fmtRelative(a.createdAt)}</div>
                  </td>
                  {op && (
                    <td className="shrink">
                      <div className="row-actions">
                        {a.status === 'OPEN' && <Button size="sm" onClick={() => act(a, 'acknowledge')} disabled={acting === a.id}>Reconocer</Button>}
                        {a.status !== 'RESOLVED' && <Button size="sm" variant="ghost" onClick={() => act(a, 'resolve')} disabled={acting === a.id}>Resolver</Button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {data && rows.length === 0 && (
            <EmptyState icon={status === 'OPEN' ? 'checkCircle' : 'bell'} tone={status === 'OPEN' && !filtersOn ? 'ok' : undefined} title={status === 'OPEN' && !filtersOn ? 'No hay alertas abiertas' : 'Sin alertas para estos filtros'} />
          )}
        </div>
        {data && (meta.total ?? 0) > 0 && (
          <div className="card-foot"><Pagination page={meta.page ?? page} totalPages={meta.totalPages ?? 1} total={meta.total ?? 0} onPage={setPage} noun="alertas" /></div>
        )}
      </Card>
    </>
  );
}
