'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { BrandMark, Icon, IconName } from '@/components/icons';
import { Button, ToastProvider } from '@/components/ui';
import { canOperate, SessionProvider, useUser } from '@/lib/client/session';
import { ROLE_LABEL } from '@/lib/client/status';
import { useLocalPref } from '@/lib/client/ui';

interface NavItem { href: string; label: string; icon: IconName; show?: boolean }

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const plainBtn = { border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer', width: '100%' } as const;

function Brand() {
  return (
    <Link href="/" className="brand" aria-label="MundoGlobal Travel, ir al panel">
      <span className="brand-mark"><BrandMark /></span>
      <span className="brand-text"><strong>MundoGlobal</strong><span>Travel · Operaciones</span></span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const u = useUser();
  const path = usePathname();
  const [collapsed, setCollapsed] = useLocalPref('mgt.sidebar.collapsed', false);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-mgt-csrf': '1' } }).catch(() => undefined);
    window.location.href = '/login';
  }

  const groups: Array<{ label: string; items: NavItem[] }> = [
    { label: 'Operacion', items: [
      { href: '/', label: 'Panel', icon: 'dashboard' },
      { href: '/alerts', label: 'Alertas', icon: 'bell' },
      { href: '/exceptions', label: 'Excepciones', icon: 'exceptions' },
    ] },
    { label: 'Ventas', items: [
      { href: '/search', label: 'Buscar y reservar', icon: 'search', show: canOperate(u) },
      { href: '/bookings', label: 'Reservas', icon: 'bookings' },
    ] },
  ];

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${open ? ' nav-open' : ''}`}>
      <a href="#main" className="skip-link">Saltar al contenido</a>
      <aside className="sidebar" aria-label="Navegacion principal">
        <Brand />
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.filter((i) => i.show !== false).map((i) => (
                <Link key={i.href} href={i.href} className="nav-link" aria-current={isActive(path, i.href) ? 'page' : undefined} title={collapsed ? i.label : undefined}>
                  <Icon name={i.icon} size={18} />
                  <span className="nav-text">{i.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip" title={collapsed ? `${u.fullName} · ${ROLE_LABEL[u.role] ?? u.role}` : undefined}>
            <span className="avatar" aria-hidden="true">{initials(u.fullName)}</span>
            <span className="user-meta"><strong>{u.fullName}</strong><span>{ROLE_LABEL[u.role] ?? u.role}</span></span>
          </div>
          <button type="button" className="nav-link" onClick={logout} style={plainBtn} title={collapsed ? 'Cerrar sesion' : undefined}>
            <Icon name="logout" size={18} /><span className="nav-text">Cerrar sesion</span>
          </button>
          <button
            type="button" className="nav-link collapse-toggle" onClick={() => setCollapsed(!collapsed)} style={plainBtn}
            aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'} aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'chevronRight' : 'panelLeft'} size={18} /><span className="nav-text">Contraer menu</span>
          </button>
        </div>
      </aside>
      {open && <button type="button" className="scrim" aria-label="Cerrar menu" onClick={() => setOpen(false)} />}
      <div className="content">
        <header className="topbar">
          <Button variant="ghost" icon="menu" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)} />
          <Brand />
        </header>
        <main id="main" className="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return <SessionProvider><ToastProvider><Shell>{children}</Shell></ToastProvider></SessionProvider>;
}
