'use client';
import { DependencyList, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from './api';

/** Carga datos y expone recarga; conserva los datos previos mientras se recarga. */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    load()
      .then((d) => { if (n === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (n === seq.current) setError(errorText(e)); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [load]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

export const errorText = (e: unknown) => (e instanceof ApiError ? `${e.message} (${e.code})` : (e as Error).message);

/* ---------- Formato ---------- */
export const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('es-AR') : '—');

export const fmtDateShort = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Fecha de calendario (YYYY-MM-DD) sin conversion de zona horaria. */
export function fmtDay(v: string | null | undefined) {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('es', { numeric: 'auto' }) : null;
export function fmtRelative(v: string | null | undefined, now = Date.now()) {
  if (!v) return '—';
  const diff = (new Date(v).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return fmtDate(v);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 2700) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 79200) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(v);
}

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('es-AR'));

/** Importe tal como viene del backend (string decimal) con separadores locales; si no es numerico se muestra sin tocar. */
export function fmtAmount(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------- Ordenamiento de tablas ---------- */
export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K; dir: SortDir }

export function useSort<T, K extends string>(rows: T[], initial: SortState<K>, accessors: Record<K, (r: T) => string | number | null>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const acc = useRef(accessors);
  acc.current = accessors;
  const sorted = useMemo(() => {
    const get = acc.current[sort.key];
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === y) return 0;
      if (x === null) return 1; // vacios siempre al final
      if (y === null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es')) * m;
    });
  }, [rows, sort]);
  const toggle = (key: K) =>
    setSort((s) => {
      if (s.key === key) return { key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      const sample = rows.length ? acc.current[key](rows[0]) : null;
      return { key, dir: typeof sample === 'number' ? 'desc' : 'asc' };
    });
  return { sorted, sort, toggle };
}

/** Preferencia local de la interfaz (p. ej. sidebar contraida). Tolera almacenamiento bloqueado. */
export function useLocalPref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(key);
      if (s !== null) setV(s === '1');
    } catch { /* sin almacenamiento */ }
  }, [key]);
  const set = useCallback((nv: boolean) => {
    setV(nv);
    try { window.localStorage.setItem(key, nv ? '1' : '0'); } catch { /* sin almacenamiento */ }
  }, [key]);
  return [v, set];
}
