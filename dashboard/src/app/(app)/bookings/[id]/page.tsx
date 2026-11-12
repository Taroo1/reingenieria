'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { Icon } from '@/components/icons';
import { Button, Callout, Card, EmptyState, ErrorBox, Money, PageHeader, PromptDialog, Severity, Skeleton, StatusBadge, Tip, useToast } from '@/components/ui';
import { api } from '@/lib/client/api';
import { canOperate, useUser } from '@/lib/client/session';
import { BOOKING, BOOKING_ITEM, EXCEPTION_STATUS, EXCEPTION_TYPE, SEVERITY, Tone } from '@/lib/client/status';
import { errorText, fmtAmount, fmtDate, fmtDay, fmtRelative, useLoad } from '@/lib/client/ui';

interface Booking {
  id: string; reference: string; status: string; currency: string; totalAmount: string; holder: { name: string; email: string }; holdExpiresAt: string | null;
  items: Array<{ id: string; status: string; product: { name: string; provider: { code: string } }; quantity: number; startDate: string; endDate: string | null; totalAmount: string; source: { currency: string; amount: string }; externalLocator: string | null }>;
  travelers: Array<{ id: string; firstName: string; lastName: string; documentNumber: string | null; isHolder: boolean }>;
  history: Array<{ from: string | null; to: string; reason: string | null; at: string }>;
  exceptions: Array<{ id: string; type: string; severity: string; status: string; title: string }>;
}
interface Outcome { status: string; errors: Array<{ code: string; message: string }> }

const OUTCOME_TONE = (s: string): 'ok' | 'bad' | 'warn' | 'info' => (s === 'CONFIRMED' || s === 'HELD' || s === 'CANCELLED' ? 'ok' : s === 'FAILED' || s === 'REQUIRES_REVIEW' ? 'bad' : s === 'PENDING_CONFIRMATION' ? 'warn' : 'info');
const ACTION_LABEL: Record<string, string> = { hold: 'Bloqueo', confirm: 'Confirmacion', cancel: 'Cancelacion', reconcile: 'Conciliacion' };

function Summary({ label, children, icon }: { label: string; children: React.ReactNode; icon: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <div className="stat" style={{ minHeight: 0 }}>
      <div className="stat-top"><span className="stat-icon"><Icon name={icon} size={15} /></span>{label}</div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

export default function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const toast = useToast();
  const { data: b, error, reload, loading } = useLoad(() => api.get<Booking>(`bookings/${id}`).then((r) => r.data), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ action: string; tone: 'ok' | 'bad' | 'warn' | 'info'; text: string; errors: Outcome['errors'] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  async function act(path: string, body?: unknown) {
    setBusy(path);
    setResult(null);
    setActionError(null);
    try {
      const r = await api.post<{ outcome?: Outcome; status?: string }>(`bookings/${id}/${path}`, body, path !== 'reconcile');
      const o = r.data.outcome;
      const status = o?.status ?? r.data.status ?? '';
      const tone = OUTCOME_TONE(status);
      const label = BOOKING[status]?.label ?? status;
      setResult({ action: path, tone, text: `Resultado: ${label}`, errors: o?.errors ?? [] });
      toast({ tone, title: `${ACTION_LABEL[path] ?? path}: ${label}`, body: o?.errors.length ? o.errors.map((e) => e.message).join('; ') : undefined });
    } catch (e) {
      setActionError(errorText(e));
      toast({ tone: 'bad', title: `${ACTION_LABEL[path] ?? path} fallida`, body: errorText(e) });
    } finally {
      setBusy(null);
      reload();
    }
  }

  const back = <Link href="/bookings"><Icon name="arrowLeft" size={14} style={{ verticalAlign: '-2px' }} /> Reservas</Link>;

  if (error) return <><PageHeader eyebrow={back} title="Reserva" /><ErrorBox error={error} title="No se pudo cargar la reserva" /></>;
  if (!b) {
    return (
      <>
        <PageHeader eyebrow={back} title={<Skeleton h={28} w={260} />} />
        <div className="grid-3 mb-4">{[0, 1, 2].map((i) => <div key={i} className="stat" style={{ minHeight: 0 }}><Skeleton w="40%" /><Skeleton h={20} w="70%" /></div>)}</div>
        <Card><div className="card-body stack">{[0, 1, 2].map((i) => <Skeleton key={i} h={32} />)}</div></Card>
      </>
    );
  }

  const op = canOperate(user);
  const pending = b.items.some((i) => i.status === 'PENDING_CONFIRMATION' || i.status === 'REQUIRES_REVIEW');
  const actions = op && (
    <>
      {pending && <Button icon="sync" loading={busy === 'reconcile'} disabled={!!busy} onClick={() => act('reconcile')}>Conciliar con el proveedor</Button>}
      {b.status === 'CONFIRMED' && <Button variant="danger" icon="ban" disabled={!!busy} loading={busy === 'cancel'} onClick={() => setCancelOpen(true)}>Cancelar reserva</Button>}
      {b.status === 'QUOTED' && <Button variant="primary" icon="lock" loading={busy === 'hold'} disabled={!!busy} onClick={() => act('hold')}>Bloquear cupo</Button>}
      {b.status === 'HELD' && <Button variant="primary" icon="check" loading={busy === 'confirm'} disabled={!!busy} onClick={() => act('confirm')}>Confirmar reserva</Button>}
    </>
  );
  const holdTone: Tone | null = b.status === 'HELD' && b.holdExpiresAt ? (new Date(b.holdExpiresAt).getTime() - Date.now() < 15 * 60_000 ? 'warn' : 'info') : null;

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={<span className="mono">{b.reference}</span>}
        badge={<StatusBadge dict={BOOKING} value={b.status} />}
        description={BOOKING[b.status]?.desc}
        actions={actions}
      />

      {result && (
        <Callout tone={result.tone} title={`${ACTION_LABEL[result.action] ?? result.action} · ${result.text}`}>
          {result.errors.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{result.errors.map((e, n) => <li key={n}><span className="mono">[{e.code}]</span> {e.message}</li>)}</ul>}
        </Callout>
      )}
      <ErrorBox error={actionError} />
      {holdTone && (
        <Callout tone={holdTone === 'warn' ? 'warn' : 'info'} title="Cupo bloqueado">
          El bloqueo vence {fmtRelative(b.holdExpiresAt)} ({fmtDate(b.holdExpiresAt)}). Confirma la reserva antes de esa hora.
        </Callout>
      )}

      <div className="grid-3 mb-4">
        <Summary label="Total" icon="cart"><Money amount={b.totalAmount} currency={b.currency} fmt={fmtAmount} /></Summary>
        <Summary label="Titular" icon="user">{b.holder.name}<div className="muted sm" style={{ fontWeight: 400 }}>{b.holder.email}</div></Summary>
        <Summary label="Items y viajeros" icon="bookings">{b.items.length} item{b.items.length === 1 ? '' : 's'} · {b.travelers.length} viajero{b.travelers.length === 1 ? '' : 's'}</Summary>
      </div>

      <div className="stack">
          <Card title="Items" sub="Precio convertido a la moneda de la reserva; debajo, el precio de origen del proveedor" busy={loading}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Producto</th><th>Fechas</th><th className="r">Cant.</th><th className="r">Total</th><th>Estado</th><th>Localizador</th></tr></thead>
                <tbody>
                  {b.items.map((i) => (
                    <tr key={i.id} className={i.status === 'REQUIRES_REVIEW' || i.status === 'FAILED' ? 'row-attn' : i.status === 'PENDING_CONFIRMATION' ? 'row-warn' : undefined}>
                      <td style={{ minWidth: 200 }}><div className="primary">{i.product.name}</div><div className="secondary mono">{i.product.provider.code}</div></td>
                      <td className="nowrap">{fmtDay(i.startDate)}{i.endDate && <div className="secondary">hasta {fmtDay(i.endDate)}</div>}</td>
                      <td className="r">{i.quantity}</td>
                      <td className="r"><Money amount={i.totalAmount} currency={b.currency} fmt={fmtAmount} /><div className="secondary">{fmtAmount(i.source.amount)} {i.source.currency}</div></td>
                      <td><StatusBadge dict={BOOKING_ITEM} value={i.status} /></td>
                      <td>{i.externalLocator ? <span className="mono">{i.externalLocator}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title="Viajeros">
            {b.travelers.length === 0 ? <EmptyState icon="users" title="Sin viajeros cargados" compact /> : (
              <ul className="list">
                {b.travelers.map((t) => (
                  <li key={t.id} className="list-item" style={{ alignItems: 'center' }}>
                    <span className="avatar" aria-hidden="true">{(t.firstName[0] ?? '') + (t.lastName[0] ?? '')}</span>
                    <div className="li-main"><div className="li-title">{t.firstName} {t.lastName}</div><div className="li-meta">{t.documentNumber ? <>Documento <span className="mono">{t.documentNumber}</span></> : 'Sin documento'}</div></div>
                    {t.isHolder && <span className="tag">Titular</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="stack">
          {b.exceptions.length > 0 && (
            <Card title="Excepciones" sub="Casos vinculados a esta reserva">
              <ul className="list">
                {b.exceptions.map((e) => (
                  <li key={e.id} className="list-item">
                    <div className="li-main">
                      <div className="li-title">{e.title}</div>
                      <div className="li-meta"><Severity value={e.severity} dict={SEVERITY} /><StatusBadge dict={EXCEPTION_TYPE} value={e.type} tip={false} /><StatusBadge dict={EXCEPTION_STATUS} value={e.status} tip={false} /></div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="card-foot"><Link href="/exceptions" className="sm">Gestionar en Excepciones <Icon name="arrowRight" size={13} style={{ verticalAlign: '-2px' }} /></Link></div>
            </Card>
          )}
          <Card title="Historial" sub="Transiciones de estado, mas antigua primero">
            {b.history.length === 0 ? <EmptyState icon="clock" title="Sin movimientos" compact /> : (
              <ol className="timeline">
                {b.history.map((h, n) => (
                  <li key={n}>
                    <div className="tl-head">
                      {h.from ? <StatusBadge dict={BOOKING} value={h.from} tip={false} /> : <span className="muted small">Creacion</span>}
                      <Icon name="arrowRight" size={13} className="muted" />
                      <StatusBadge dict={BOOKING} value={h.to} tip={false} />
                    </div>
                    {h.reason && <div className="sm text-2 mt-2">{h.reason}</div>}
                    <div className="tl-meta"><Tip content={fmtDate(h.at)} align="start">{fmtRelative(h.at)}</Tip></div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
      </div>

      <PromptDialog
        open={cancelOpen} onClose={() => setCancelOpen(false)} tone="danger"
        title={`Cancelar la reserva ${b.reference}`}
        description="Se solicitara la cancelacion a cada proveedor y se devolvera el cupo propio. El motivo queda registrado en el historial."
        label="Motivo de la cancelacion" placeholder="Ej.: pedido del cliente por cambio de fechas" confirmLabel="Cancelar reserva"
        onConfirm={async (reason) => { setCancelOpen(false); await act('cancel', { reason }); }}
      />
    </>
  );
}
