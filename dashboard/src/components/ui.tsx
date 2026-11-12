'use client';
import Link from 'next/link';
import {
  ButtonHTMLAttributes, createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState,
} from 'react';
import { lookup, StatusDef, Tone } from '@/lib/client/status';
import { SortState } from '@/lib/client/ui';
import { Icon, IconName } from './icons';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/* =================== Button =================== */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', icon, loading, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', variant !== 'secondary' && `btn-${variant}`, size !== 'md' && `btn-${size}`, !children && 'btn-icon', block && 'btn-block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'secondary', size = 'md', icon, children }: { href: string; variant?: BtnVariant; size?: 'sm' | 'md'; icon?: IconName; children: ReactNode }) {
  return (
    <Link href={href} className={cx('btn', variant !== 'secondary' && `btn-${variant}`, size === 'sm' && 'btn-sm')}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}{children}
    </Link>
  );
}

/* =================== Tooltip =================== */
export function Tip({ content, children, placement = 'top', align = 'center' }: { content: ReactNode; children: ReactNode; placement?: 'top' | 'below'; align?: 'center' | 'start' }) {
  const id = useId();
  return (
    <span className="tip">
      <span className="tip-trigger" tabIndex={0} aria-describedby={id}>{children}</span>
      <span role="tooltip" id={id} className={cx('tip-bubble', placement === 'below' && 'below', align === 'start' && 'start')}>{content}</span>
    </span>
  );
}

export function HelpTip({ children, label = 'Mas informacion' }: { children: ReactNode; label?: string }) {
  const id = useId();
  return (
    <span className="tip">
      <span className="help-icon" tabIndex={0} aria-label={label} aria-describedby={id} role="img"><Icon name="help" size={14} /></span>
      <span role="tooltip" id={id} className="tip-bubble below">{children}</span>
    </span>
  );
}

/* =================== Badges =================== */
export function ToneBadge({ tone, children, dot = true, outline, icon, pulse, title }: { tone: Tone; children: ReactNode; dot?: boolean; outline?: boolean; icon?: IconName; pulse?: boolean; title?: string }) {
  return (
    <span className={cx('badge', tone, outline && 'outline', pulse && 'pulse')} title={title}>
      {icon ? <Icon name={icon} size={13} /> : dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Badge semantico: traduce el codigo del backend segun su dominio; el codigo original queda en el tooltip. */
export function StatusBadge({ dict, value, outline, icon, pulse, tip = true }: { dict: Record<string, StatusDef>; value: string | null | undefined; outline?: boolean; icon?: IconName; pulse?: boolean; tip?: boolean }) {
  const d = lookup(dict, value);
  if (!d || !value) return <span className="muted">—</span>;
  const badge = <ToneBadge tone={d.tone} outline={outline} icon={icon} pulse={pulse}>{d.label}</ToneBadge>;
  if (!tip) return badge;
  return <Tip content={<><strong>{d.label} <span className="muted mono">{value}</span></strong>{d.desc}</>}>{badge}</Tip>;
}

/** Compatibilidad: badge simple por codigo (tono neutro si no se conoce). */
export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="badge neutral">{value}</span>;
}

export function Severity({ value, dict }: { value: string; dict: Record<string, StatusDef> }) {
  const d = lookup(dict, value)!;
  const lvl = ({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as Record<string, number>)[value] ?? 0;
  return (
    <span className={cx('sev', d.tone)} title={value}>
      <span className="sev-bars" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= lvl ? 'on' : ''} />)}</span>
      {d.label}
    </span>
  );
}

export function Money({ amount, currency, fmt }: { amount: string | number; currency: string; fmt: (v: string | number) => string }) {
  return <span className="amount">{fmt(amount)}<span className="cur">{currency}</span></span>;
}

/* =================== Layout =================== */
export function PageHeader({ title, description, actions, eyebrow, badge }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <div className="title-row"><h1>{title}</h1>{badge}</div>
        {description && <p className="desc">{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, sub, actions, children, className, bodyClass, footer, busy }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; footer?: ReactNode; busy?: boolean }) {
  return (
    <section className={cx('card rel', className)}>
      {busy && <div className="loading-bar" aria-hidden="true" />}
      {(title || actions) && (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>{title && <h2>{title}</h2>}{sub && <div className="sub">{sub}</div>}</div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function StatCard({ label, value, suffix, icon, tone, href, foot, hint }: { label: string; value: ReactNode; suffix?: ReactNode; icon: IconName; tone?: Tone; href?: string; foot?: ReactNode; hint?: string }) {
  const body = (
    <>
      <div className="stat-top">
        <span className={cx('stat-icon', tone)}><Icon name={icon} size={15} /></span>
        <span>{label}</span>
        {href && <span className="stat-go"><Icon name="arrowRight" size={15} /></span>}
      </div>
      <div className="stat-value">{value}{suffix && <small>{suffix}</small>}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </>
  );
  return href
    ? <Link href={href} className="stat" title={hint} aria-label={`${label}: ${typeof value === 'number' || typeof value === 'string' ? value : ''}. ${hint ?? 'Ver detalle'}`}>{body}</Link>
    : <div className="stat" title={hint}>{body}</div>;
}

/* =================== Feedback =================== */
const CALLOUT_ICON: Record<string, IconName> = { bad: 'alertCircle', warn: 'exceptions', ok: 'checkCircle', info: 'info' };
export function Callout({ tone = 'info', title, children, flush, action }: { tone?: 'bad' | 'warn' | 'ok' | 'info'; title?: ReactNode; children?: ReactNode; flush?: boolean; action?: ReactNode }) {
  return (
    <div className={cx('callout', tone, flush && 'flush')} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={CALLOUT_ICON[tone]} size={16} />
      <div className="callout-body">{title && <strong>{title}</strong>}{children}</div>
      {action}
    </div>
  );
}

export function ErrorBox({ error, title = 'No se pudo completar la operacion' }: { error: string | null; title?: string }) {
  return error ? <Callout tone="bad" title={title}>{error}</Callout> : null;
}

export function EmptyState({ icon = 'inbox', title, children, tone, compact, action }: { icon?: IconName; title: string; children?: ReactNode; tone?: 'ok'; compact?: boolean; action?: ReactNode }) {
  return (
    <div className={cx('empty', compact && 'compact')}>
      <span className={cx('empty-icon', tone)}><Icon name={icon} size={20} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}><span className="skeleton" style={{ height: 12, width: c === 0 ? '70%' : `${40 + ((r * 7 + c * 13) % 40)}%` }} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

/* =================== Forms =================== */
export function Field({ label, hint, required, children, className }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      <span className="field-label">{label}{required && <span className="req" aria-hidden="true">*</span>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <div className={cx('input-icon', className)}>
      <Icon name="search" size={15} />
      <input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* =================== Tables =================== */
export function SortTh<K extends string>({ k, sort, onSort, children, align, className }: { k: K; sort: SortState<K>; onSort: (k: K) => void; children: ReactNode; align?: 'r'; className?: string }) {
  const active = sort.key === k;
  return (
    <th className={cx(align, className)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" data-active={active} onClick={() => onSort(k)}>
        {children}
        <Icon name={active ? (sort.dir === 'asc' ? 'sortAsc' : 'sortDesc') : 'sort'} size={12} />
      </button>
    </th>
  );
}

export function Pagination({ page, totalPages, total, onPage, noun = 'registros' }: { page: number; totalPages: number; total: number; onPage: (p: number) => void; noun?: string }) {
  return (
    <>
      <span className="pager info">{total.toLocaleString('es-AR')} {noun} · pagina {page} de {Math.max(totalPages, 1)}</span>
      <nav className="pager" aria-label="Paginacion">
        <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <Button size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Siguiente <Icon name="chevronRight" size={14} /></Button>
      </nav>
    </>
  );
}

/* =================== Modal con texto obligatorio (reemplaza window.prompt) =================== */
export function PromptDialog({ open, title, description, label, placeholder, confirmLabel, tone = 'primary', onConfirm, onClose }: {
  open: boolean; title: string; description?: ReactNode; label: string; placeholder?: string; confirmLabel: string;
  tone?: 'primary' | 'danger'; onConfirm: (text: string) => Promise<void> | void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setText(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await onConfirm(text.trim()); } finally { setBusy(false); }
  }
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={(e) => { if (busy) e.preventDefault(); }} aria-labelledby={`${fieldId}-t`}>
      <form onSubmit={submit}>
        <div className="modal-head"><h2 id={`${fieldId}-t`}>{title}</h2>{description && <p>{description}</p>}</div>
        <div className="modal-body">
          <Field label={label} required>
            <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} required maxLength={2000} autoFocus />
          </Field>
          <div className="field-hint mt-2">{text.length}/2000</div>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant={tone} loading={busy} disabled={!text.trim()}>{confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}

/* =================== Toasts =================== */
interface ToastMsg { id: number; tone: 'ok' | 'bad' | 'info' | 'warn'; title: string; body?: string }
const ToastCtx = createContext<(t: Omit<ToastMsg, 'id'>) => void>(() => undefined);
const TOAST_ICON: Record<ToastMsg['tone'], IconName> = { ok: 'checkCircle', bad: 'alertCircle', info: 'info', warn: 'exceptions' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const dismiss = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<ToastMsg, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.tone === 'bad' ? 9000 : 5000);
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={cx('toast', t.tone)} role={t.tone === 'bad' ? 'alert' : 'status'}>
            <Icon name={TOAST_ICON[t.tone]} size={16} />
            <div className="toast-body"><strong>{t.title}</strong>{t.body}</div>
            <Button variant="ghost" size="sm" icon="x" aria-label="Cerrar notificacion" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
