'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, PromptDialog, Segmented, Severity, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { api, Meta, qs } from '@/lib/client/api';
import { canOperate, useUser } from '@/lib/client/session';
import { EXCEPTION_STATUS, EXCEPTION_TYPE, SEVERITY } from '@/lib/client/status';
import { errorText, fmtDate, fmtDateShort, fmtRelative, useLoad } from '@/lib/client/ui';

interface ExceptionRow {
  id: string; type: string; severity: string; status: string; title: string; description: string | null; createdAt: string;
  booking: { id: string; reference: string } | null; provider: { code: string } | null; assignedTo: { email: string } | null;
}
type StatusFilter = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';
type CloseKind = 'resolve' | 'dismiss';
const PAGE_SIZE = 25;

export default function ExceptionsPage() {
  const user = useUser();
  const op = canOperate(user);
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ row: ExceptionRow; kind: CloseKind } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(
    () => api.get<ExceptionRow[]>(`exceptions${qs({ status, severity, type, page, pageSize: PAGE_SIZE })}`),
    [status, severity, type, page],
  );
  const meta: Meta = data?.meta ?? {};
  const rows = data?.data ?? [];
  const reset = (fn: () => void) => { fn(); setPage(1); setExpanded(null); };

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setActing(id);
    try {
      await fn();
      toast({ tone: 'ok', title: ok });
    } catch (e) {
      toast({ tone: 'bad', title: 'No se pudo actualizar la excepcion', body: errorText(e) });
    } finally {
      setActing(null);
      reload();
    }
  }
  const assignMe = (x: ExceptionRow) => act(x.id, () => api.patch(`exceptions/${x.id}/assign`, { assignedToId: user.id }), `Tomaste el caso «${x.title}»`);
  const close = async (resolution: string) => {
    if (!closing) return;
    const { row, kind } = closing;
    setClosing(null);
    await act(row.id, () => api.post(`exceptions/${row.id}/${kind}`, { resolution }), kind === 'resolve' ? 'Excepcion resuelta' : 'Excepcion descartada');
  };

  const cols = op ? 7 : 6;
  return (
    <>
      <PageHeader
        title="Excepciones"
        description="Casos que el motor no pudo resolver solo: errores y timeouts de proveedores, cambios de precio, confirmaciones parciales y diferencias de conciliacion."
        actions={<Button icon="refresh" onClick={reload} loading={loading && !!data}>Actualizar</Button>}
      />
      <Card busy={loading && !!data}>
        <div className="toolbar">
          <Segmented<StatusFilter> label="Estado de resolucion" value={status} onChange={(v) => reset(() => setStatus(v))} options={[
            { value: 'OPEN', label: 'Abiertas' }, { value: 'IN_PROGRESS', label: 'En curso' }, { value: 'RESOLVED', label: 'Resueltas' }, { value: 'DISMISSED', label: 'Descartadas' },
          ]} />
          <select className="select" value={severity} onChange={(e) => reset(() => setSeverity(e.target.value))} aria-label="Filtrar por severidad">
            <option value="">Todas las severidades</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="select" value={type} onChange={(e) => reset(() => setType(e.target.value))} aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            {Object.entries(EXCEPTION_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {(severity || type) && <Button size="sm" variant="ghost" onClick={() => reset(() => { setSeverity(''); setType(''); })}>Limpiar filtros</Button>}
        </div>
        <ErrorBox error={error} title="No se pudieron cargar las excepciones" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="shrink"><span className="sr-only">Detalle</span></th>
                <th>Severidad</th><th>Caso</th><th>Afecta a</th><th>Asignado</th><th>Creado</th>
                {op && <th className="r"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {!data && !error && <SkeletonRows cols={cols} />}
              {rows.map((x) => {
                const open = expanded === x.id;
                const active = x.status === 'OPEN' || x.status === 'IN_PROGRESS';
                return (
                  <Fragment key={x.id}>
                    <tr className={active && (x.severity === 'CRITICAL' || x.severity === 'HIGH') ? 'row-attn' : undefined}>
                      <td className="shrink">
                        <Button size="sm" variant="ghost" icon={open ? 'chevronDown' : 'chevronRight'} aria-expanded={open} aria-controls={`exc-${x.id}`} aria-label={open ? 'Ocultar detalle' : 'Ver detalle'} onClick={() => setExpanded(open ? null : x.id)} />
                      </td>
                      <td className="shrink"><Severity value={x.severity} dict={SEVERITY} /></td>
                      <td style={{ minWidth: 300 }}>
                        <div className="primary">{x.title}</div>
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          <StatusBadge dict={EXCEPTION_TYPE} value={x.type} />
                          {status !== x.status && <StatusBadge dict={EXCEPTION_STATUS} value={x.status} />}
                        </div>
                        {x.description && !open && <div className="secondary truncate" style={{ maxWidth: 520 }}>{x.description}</div>}
                      </td>
                      <td>
                        {x.booking ? <Link href={`/bookings/${x.booking.id}`} className="mono nowrap">{x.booking.reference}</Link> : null}
                        {x.provider ? <div className={x.booking ? 'secondary mono' : 'mono'}>{x.provider.code}</div> : null}
                        {!x.booking && !x.provider && <span className="muted">—</span>}
                      </td>
                      <td>{x.assignedTo ? <span className="sm">{x.assignedTo.email}</span> : <span className="muted sm">Sin asignar</span>}</td>
                      <td className="nowrap" title={fmtDate(x.createdAt)}>{fmtDateShort(x.createdAt)}<div className="secondary">{fmtRelative(x.createdAt)}</div></td>
                      {op && (
                        <td className="shrink">
                          {active && (
                            <div className="row-actions">
                              {x.status === 'OPEN' && <Button size="sm" icon="user" onClick={() => assignMe(x)} disabled={acting === x.id}>Tomar</Button>}
                              <Button size="sm" variant="primary" icon="check" onClick={() => setClosing({ row: x, kind: 'resolve' })} disabled={acting === x.id}>Resolver</Button>
                              <Button size="sm" variant="ghost" onClick={() => setClosing({ row: x, kind: 'dismiss' })} disabled={acting === x.id}>Descartar</Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {open && (
                      <tr className="detail-row" id={`exc-${x.id}`}>
                        <td colSpan={cols}>
                          <div style={{ padding: '14px 20px 16px 64px' }}>
                            {x.description && <p className="sm text-2 mb-4" style={{ whiteSpace: 'pre-wrap', maxWidth: '100ch' }}>{x.description}</p>}
                            <dl className="kv">
                              <dt>ID del caso</dt><dd className="mono">{x.id}</dd>
                              <dt>Tipo</dt><dd><span className="mono">{x.type}</span> · {EXCEPTION_TYPE[x.type]?.label}</dd>
                              <dt>Estado</dt><dd><span className="mono">{x.status}</span> · {EXCEPTION_STATUS[x.status]?.label}</dd>
                              <dt>Severidad</dt><dd className="mono">{x.severity}</dd>
                              <dt>Reserva</dt><dd>{x.booking ? <Link href={`/bookings/${x.booking.id}`} className="mono">{x.booking.reference}</Link> : '—'}</dd>
                              <dt>Proveedor</dt><dd className="mono">{x.provider?.code ?? '—'}</dd>
                              <dt>Creado</dt><dd>{fmtDate(x.createdAt)}</dd>
                            </dl>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {data && rows.length === 0 && (
            <EmptyState icon={status === 'OPEN' ? 'checkCircle' : 'inbox'} tone={status === 'OPEN' && !severity && !type ? 'ok' : undefined}
              title={status === 'OPEN' && !severity && !type ? 'No hay excepciones abiertas' : 'No hay casos para estos filtros'} />
          )}
        </div>
        {data && (meta.total ?? 0) > 0 && (
          <div className="card-foot"><Pagination page={meta.page ?? page} totalPages={meta.totalPages ?? 1} total={meta.total ?? 0} onPage={(p) => { setPage(p); setExpanded(null); }} noun="casos" /></div>
        )}
      </Card>

      <PromptDialog
        open={!!closing} onClose={() => setClosing(null)}
        tone={closing?.kind === 'dismiss' ? 'danger' : 'primary'}
        title={closing?.kind === 'resolve' ? 'Resolver excepcion' : 'Descartar excepcion'}
        description={closing?.row.title}
        label={closing?.kind === 'resolve' ? 'Que se hizo para resolverlo' : 'Motivo para descartarlo'}
        placeholder={closing?.kind === 'resolve' ? 'Ej.: se confirmo manualmente con el proveedor, localizador ABC123' : 'Ej.: duplicado del caso anterior'}
        confirmLabel={closing?.kind === 'resolve' ? 'Marcar como resuelta' : 'Descartar'}
        onConfirm={close}
      />
    </>
  );
}

