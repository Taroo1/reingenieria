'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, IconName } from '@/components/icons';
import { Button, Callout, Card, EmptyState, ErrorBox, Field, Money, PageHeader, Segmented, SkeletonRows, StatusBadge, Tip, ToneBadge } from '@/components/ui';
import { api } from '@/lib/client/api';
import { OFFER_SOURCE, PRODUCT_KIND } from '@/lib/client/status';
import { errorText, fmtAmount, fmtDay } from '@/lib/client/ui';

interface Offer {
  productId: string; name: string; kind: string; source: string; provider: { code: string; name: string };
  startDate: string; endDate: string | null; quantity: number; available: number; price: { total: string; currency: string } | null;
}
interface ProviderOutcome { code: string; source: string; ok: boolean; offers: number; error?: { code: string; message: string } }
interface Quote { id: string; reference: string; currency: string; totalAmount: string; expiresAt: string; items: Array<{ product: { name: string }; totalAmount: string; source: { currency: string; amount: string } }> }

type Kind = 'ROOM' | 'FLIGHT' | 'ASSISTANCE_PLAN';
type Busy = 'search' | 'quote' | 'book' | null;
const KIND_ICON: Record<Kind, IconName> = { ROOM: 'bed', FLIGHT: 'plane', ASSISTANCE_PLAN: 'heart' };

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Buscar disponibilidad', 'Seleccionar y cotizar', 'Datos del titular'];
  return (
    <ol className="stepper" aria-label="Pasos de la reserva">
      {steps.map((s, n) => {
        const i = n + 1;
        const state = i < step ? 'done' : i === step ? 'active' : '';
        return (
          <li key={s} className="row" style={{ gap: 10 }} aria-current={i === step ? 'step' : undefined}>
            {n > 0 && <span className="step-sep" aria-hidden="true" />}
            <span className={`step ${state}`}><span className="step-n">{i < step ? <Icon name="check" size={12} /> : i}</span>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function SearchPage() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('ROOM');
  const [startDate, setStartDate] = useState('');
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [outcomes, setOutcomes] = useState<ProviderOutcome[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  async function run<T>(what: Busy, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: Record<string, unknown> = { kind, startDate: f.startDate, quantity: Number(f.quantity) };
    if (kind !== 'FLIGHT' && f.endDate) body.endDate = f.endDate;
    if (kind === 'FLIGHT') {
      if (f.origin) body.origin = f.origin;
      if (f.destination) body.destination = f.destination;
    }
    setQuote(null);
    setSelected(new Set());
    const r = await run('search', () => api.post<{ offers: Offer[]; providers: ProviderOutcome[] }>('search', body));
    if (r) {
      setOffers(r.data.offers);
      setOutcomes(r.data.providers);
    }
  }

  async function makeQuote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const currency = String(new FormData(e.currentTarget).get('currency'));
    const items = (offers ?? []).filter((o) => selected.has(o.productId)).map((o) => ({
      productId: o.productId, startDate: o.startDate, ...(o.endDate && { endDate: o.endDate }), quantity: o.quantity,
    }));
    const r = await run('quote', () => api.post<Quote>('quotes', { currency, items }, true));
    if (r) {
      setQuote(r.data);
      requestAnimationFrame(() => document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  async function book(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quote) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const traveler = { firstName: f.firstName, lastName: f.lastName, isHolder: true, ...(f.documentNumber && { documentType: 'DNI', documentNumber: f.documentNumber }) };
    const r = await run('book', () => api.post<{ id: string }>('bookings', { quoteId: quote.id, holderName: `${f.firstName} ${f.lastName}`, holderEmail: f.email, travelers: [traveler] }, true));
    if (r) router.push(`/bookings/${r.data.id}`);
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const changeKind = (k: Kind) => { setKind(k); setOffers(null); setOutcomes([]); setSelected(new Set()); setQuote(null); };
  const step: 1 | 2 | 3 = quote ? 3 : offers && offers.length ? 2 : 1;
  const failed = outcomes.filter((o) => !o.ok);
  const selectedOffers = (offers ?? []).filter((o) => selected.has(o.productId));
  const selCurrencies = [...new Set(selectedOffers.map((o) => o.price?.currency).filter(Boolean))];

  return (
    <>
      <PageHeader title="Buscar y reservar" description="Consulta el cupo propio y los proveedores en vivo, cotiza en una sola moneda y crea la reserva." />
      <Stepper step={step} />

      <Card title="Criterios de busqueda" className="mb-4">
        <form className="card-body" onSubmit={search}>
          <div className="row mb-4">
            <Segmented<Kind> label="Tipo de producto" value={kind} onChange={changeKind} options={(Object.keys(KIND_ICON) as Kind[]).map((k) => ({
              value: k, label: <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Icon name={KIND_ICON[k]} size={14} />{PRODUCT_KIND[k]}</span>,
            }))} />
          </div>
          <div className="form-grid">
            <Field label={kind === 'FLIGHT' ? 'Fecha de salida' : 'Desde'} required>
              <input className="input" name="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            {kind !== 'FLIGHT' && (
              <Field label="Hasta" required={kind === 'ROOM'} hint={kind === 'ROOM' ? undefined : 'Opcional'}>
                <input className="input" name="endDate" type="date" required={kind === 'ROOM'} min={startDate || undefined} />
              </Field>
            )}
            {kind === 'FLIGHT' && (
              <>
                <Field label="Origen" hint="Codigo IATA de 3 letras">
                  <input className="input mono" name="origin" maxLength={3} minLength={3} pattern="[A-Za-z]{3}" placeholder="EZE" autoComplete="off" style={{ textTransform: 'uppercase' }} />
                </Field>
                <Field label="Destino" hint="Codigo IATA de 3 letras">
                  <input className="input mono" name="destination" maxLength={3} minLength={3} pattern="[A-Za-z]{3}" placeholder="PUJ" autoComplete="off" style={{ textTransform: 'uppercase' }} />
                </Field>
              </>
            )}
            <Field label="Cantidad" required hint={kind === 'ROOM' ? 'Habitaciones' : kind === 'FLIGHT' ? 'Pasajeros' : 'Planes'}>
              <input className="input" name="quantity" type="number" min={1} max={20} defaultValue={1} required />
            </Field>
            <div className="field" style={{ alignSelf: 'start', paddingTop: 26 }}>
              <Button type="submit" variant="primary" icon="search" loading={busy === 'search'} disabled={!!busy}>{busy === 'search' ? 'Buscando…' : 'Buscar'}</Button>
            </div>
          </div>
        </form>
      </Card>

      <ErrorBox error={error} />

      {busy === 'search' && (
        <Card title="Consultando proveedores…" sub="Cupo propio y proveedores en vivo" busy className="mb-4">
          <div className="table-wrap"><table className="table"><tbody><SkeletonRows rows={4} cols={6} /></tbody></table></div>
        </Card>
      )}

      {offers && busy !== 'search' && (
        <Card
          className="mb-4"
          title={`${offers.length} oferta${offers.length === 1 ? '' : 's'} disponible${offers.length === 1 ? '' : 's'}`}
          sub={`${PRODUCT_KIND[kind]} · ${outcomes.length} origen${outcomes.length === 1 ? '' : 'es'} consultado${outcomes.length === 1 ? '' : 's'}`}
          actions={outcomes.length > 0 && (
            <div className="chips">
              {outcomes.map((o) => (
                o.ok
                  ? <ToneBadge key={o.code + o.source} tone="ok" title={`${o.code}: ${o.offers} oferta(s)`}>{o.code} · {o.offers}</ToneBadge>
                  : <Tip key={o.code + o.source} content={<><strong>{o.code} sin respuesta</strong>{o.error?.message} {o.error?.code && <span className="mono">({o.error.code})</span>}</>}><ToneBadge tone="bad">{o.code}</ToneBadge></Tip>
              ))}
            </div>
          )}
        >
          {failed.length > 0 && (
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <Callout tone="warn" title={`${failed.length} proveedor${failed.length === 1 ? '' : 'es'} no respondi${failed.length === 1 ? 'o' : 'eron'}`}>
                Se muestran las ofertas del resto. {failed.map((o) => `${o.code}: ${o.error?.message ?? 'sin detalle'}`).join(' · ')}
              </Callout>
            </div>
          )}
          {offers.length === 0 ? (
            <EmptyState icon="search" title="Sin resultados para esta busqueda">Proba con otras fechas, otra cantidad u otro tipo de producto.</EmptyState>
          ) : (
            <form onSubmit={makeQuote}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th className="shrink"><span className="sr-only">Elegir</span></th><th>Producto</th><th>Proveedor</th><th>Origen</th><th>Fechas</th><th className="r">Disponible</th><th className="r">Precio</th></tr></thead>
                  <tbody>
                    {offers.map((o) => {
                      const sel = selected.has(o.productId);
                      return (
                        <tr key={o.productId} className={sel ? 'row-selected' : undefined} onClick={(e) => { if (o.price && !(e.target as HTMLElement).closest('input')) toggle(o.productId); }} style={{ cursor: o.price ? 'pointer' : 'default' }}>
                          <td className="shrink"><input className="checkbox" type="checkbox" aria-label={`Elegir ${o.name}`} checked={sel} disabled={!o.price} onChange={() => toggle(o.productId)} /></td>
                          <td style={{ minWidth: 220 }}><div className="primary">{o.name}</div><div className="secondary">{PRODUCT_KIND[o.kind] ?? o.kind} · cantidad {o.quantity}</div></td>
                          <td><div className="mono">{o.provider.code}</div><div className="secondary">{o.provider.name}</div></td>
                          <td><StatusBadge dict={OFFER_SOURCE} value={o.source} /></td>
                          <td className="nowrap">{fmtDay(o.startDate)}{o.endDate && <div className="secondary">hasta {fmtDay(o.endDate)}</div>}</td>
                          <td className="r">{o.available}</td>
                          <td className="r">{o.price ? <Money amount={o.price.total} currency={o.price.currency} fmt={fmtAmount} /> : <span className="muted sm">Sin tarifa</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="card-foot">
                <span className="sm text-2">
                  {selected.size === 0 ? 'Selecciona uno o mas items con tarifa para cotizar.' : <>{selected.size} item{selected.size === 1 ? '' : 's'} seleccionado{selected.size === 1 ? '' : 's'}{selCurrencies.length > 1 && <> · monedas de origen {selCurrencies.join(', ')}</>}</>}
                </span>
                <div className="row">
                  <label className="row sm text-2" style={{ gap: 8 }}>Moneda de la cotizacion
                    <select className="select" name="currency" defaultValue="USD" style={{ width: 96 }}><option>USD</option><option>EUR</option><option>ARS</option></select>
                  </label>
                  <Button type="submit" variant="primary" loading={busy === 'quote'} disabled={!!busy || selected.size === 0}>Cotizar {selected.size > 0 ? `${selected.size} item${selected.size === 1 ? '' : 's'}` : ''}</Button>
                </div>
              </div>
            </form>
          )}
        </Card>
      )}

      {quote && (
        <div id="quote" className="grid-2" style={{ scrollMarginTop: 24, alignItems: 'start' }}>
          <Card title={<>Cotizacion <span className="mono">{quote.reference}</span></>} sub={`Vence a las ${new Date(quote.expiresAt).toLocaleTimeString('es-AR')}`}>
            <ul className="list">
              {quote.items.map((i, n) => (
                <li key={n} className="list-item">
                  <div className="li-main"><div className="li-title">{i.product.name}</div><div className="li-meta">Origen: {fmtAmount(i.source.amount)} {i.source.currency}</div></div>
                  <Money amount={i.totalAmount} currency={quote.currency} fmt={fmtAmount} />
                </li>
              ))}
            </ul>
            <div className="card-foot">
              <span className="text-2">Total</span>
              <span style={{ fontSize: 'var(--fs-xl)' }}><Money amount={quote.totalAmount} currency={quote.currency} fmt={fmtAmount} /></span>
            </div>
          </Card>

          <Card title="Datos del titular" sub="Se crea la reserva en estado Cotizada; despues podras bloquear y confirmar">
            <form className="card-body" onSubmit={book}>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Field label="Nombre" required><input className="input" name="firstName" required autoComplete="given-name" /></Field>
                <Field label="Apellido" required><input className="input" name="lastName" required autoComplete="family-name" /></Field>
                <Field label="Correo electronico" required><input className="input" name="email" type="email" required autoComplete="email" placeholder="nombre@dominio.com" /></Field>
                <Field label="Documento (DNI)" hint="Opcional"><input className="input" name="documentNumber" inputMode="numeric" /></Field>
              </div>
              <div className="form-actions mt-4">
                <Button variant="ghost" onClick={() => setQuote(null)} disabled={!!busy}>Volver a la seleccion</Button>
                <Button type="submit" variant="primary" icon="check" loading={busy === 'book'} disabled={!!busy}>Crear reserva</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
