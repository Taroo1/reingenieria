'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Icon } from '@/components/icons';
import { Button, ButtonLink, Card, EmptyState, ErrorBox, PageHeader, Pagination, SkeletonRows, StatusBadge, Money } from '@/components/ui';
import { api, Meta, qs } from '@/lib/client/api';
import { canOperate, useUser } from '@/lib/client/session';
import { BOOKING, BOOKING_ATTENTION } from '@/lib/client/status';
import { fmtAmount, fmtDateShort, fmtRelative, useLoad } from '@/lib/client/ui';

interface BookingRow { id: string; reference: string; status: string; totalAmount: string; currency: string; holder: { name: string; email: string }; requestedAt: string; items: unknown[] }

const STATUSES = ['QUOTED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'REQUIRES_REVIEW', 'COMPENSATING', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED', 'EXPIRED'];
const PAGE_SIZE = 20;

function BookingsList() {
  const router = useRouter();
  const params = useSearchParams();
  const user = useUser();
  const initialStatus = params.get('status') ?? '';
  const [status, setStatus] = useState(STATUSES.includes(initialStatus) ? initialStatus : '');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [applied, setApplied] = useState('');

  // El backend filtra por referencia exacta o por correo exacto del titular.
  const isEmail = applied.includes('@');
  const { data, error, loading, reload } = useLoad(
    () => api.get<BookingRow[]>(`bookings${qs({ status, page, pageSize: PAGE_SIZE, reference: isEmail ? undefined : applied.toUpperCase(), holderEmail: isEmail ? applied : undefined })}`),
    [status, page, applied],
  );
  const meta: Meta = data?.meta ?? {};
  const rows = data?.data ?? [];

  function changeStatus(s: string) {
    setStatus(s);
    setPage(1);
    router.replace(s ? `/bookings?status=${s}` : '/bookings', { scroll: false });
  }
  function search(e: FormEvent) {
    e.preventDefault();
    setApplied(term.trim());
    setPage(1);
  }
  const clear = () => { setTerm(''); setApplied(''); changeStatus(''); };

  return (
    <>
      <PageHeader
        title="Reservas"
        description="Todas las reservas del motor, mas recientes primero. Abri una reserva para bloquear, confirmar, cancelar o conciliar."
        actions={<>
          <Button icon="refresh" onClick={reload} loading={loading && !!data}>Actualizar</Button>
          {canOperate(user) && <ButtonLink href="/search" variant="primary" icon="search">Nueva reserva</ButtonLink>}
        </>}
      />
      <Card busy={loading && !!data}>
        <form className="toolbar" onSubmit={search} role="search">
          <div className="input-icon grow">
            <Icon name="search" size={15} />
            <input className="input" type="search" value={term} onChange={(e) => { setTerm(e.target.value); if (!e.target.value) { setApplied(''); setPage(1); } }} placeholder="Referencia exacta o correo del titular" aria-label="Buscar por referencia o correo del titular" />
          </div>
          <Button type="submit" size="sm">Buscar</Button>
          <select className="select" value={status} onChange={(e) => changeStatus(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s} value={s}>{BOOKING[s]?.label ?? s}{BOOKING_ATTENTION.includes(s) ? ' · requiere atencion' : ''}</option>)}
          </select>
          {(status || applied) && <Button size="sm" variant="ghost" onClick={clear}>Limpiar filtros</Button>}
          {applied && <span className="count">Coincidencia exacta por {isEmail ? 'correo' : 'referencia'}: <span className="mono">{applied}</span></span>}
        </form>
        <ErrorBox error={error} title="No se pudieron cargar las reservas" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Referencia</th><th>Estado</th><th>Titular</th><th className="r">Items</th><th className="r">Total</th><th>Solicitada</th><th className="r"><span className="sr-only">Abrir</span></th></tr>
            </thead>
            <tbody>
              {!data && !error && <SkeletonRows cols={7} />}
              {rows.map((b) => (
                <tr key={b.id} className={BOOKING_ATTENTION.includes(b.status) ? 'row-warn' : undefined}>
                  <td><Link href={`/bookings/${b.id}`} className="mono strong">{b.reference}</Link></td>
                  <td><StatusBadge dict={BOOKING} value={b.status} /></td>
                  <td style={{ minWidth: 200 }}><div className="primary">{b.holder.name}</div><div className="secondary">{b.holder.email}</div></td>
                  <td className="r">{b.items.length}</td>
                  <td className="r"><Money amount={b.totalAmount} currency={b.currency} fmt={fmtAmount} /></td>
                  <td className="nowrap" title={new Date(b.requestedAt).toLocaleString('es-AR')}>{fmtDateShort(b.requestedAt)}<div className="secondary">{fmtRelative(b.requestedAt)}</div></td>
                  <td className="shrink r"><ButtonLink href={`/bookings/${b.id}`} size="sm" variant="ghost">Ver <Icon name="chevronRight" size={14} /></ButtonLink></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && rows.length === 0 && (
            <EmptyState icon="bookings" title={status || applied ? 'Ninguna reserva coincide' : 'Todavia no hay reservas'}
              action={status || applied ? <Button size="sm" onClick={clear}>Limpiar filtros</Button> : canOperate(user) ? <ButtonLink href="/search" size="sm" variant="primary">Crear la primera reserva</ButtonLink> : undefined}>
              {applied ? 'La busqueda es por coincidencia exacta de referencia (p. ej. MGT-…) o correo del titular.' : undefined}
            </EmptyState>
          )}
        </div>
        {data && (meta.total ?? 0) > 0 && (
          <div className="card-foot"><Pagination page={meta.page ?? page} totalPages={meta.totalPages ?? 1} total={meta.total ?? 0} onPage={setPage} noun="reservas" /></div>
        )}
      </Card>
    </>
  );
}

export default function BookingsPage() {
  return <Suspense><BookingsList /></Suspense>;
}
