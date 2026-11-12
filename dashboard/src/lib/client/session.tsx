'use client';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from './api';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'OPERADOR' | 'CONSULTA';
}

const Ctx = createContext<User | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    api.get<User>('auth/me').then((r) => setUser(r.data)).catch(() => undefined);
  }, []);
  if (!user) return <div className="boot" role="status"><div className="boot-inner"><span className="spinner" aria-hidden="true" />Cargando sesion…</div></div>;
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useUser(): User {
  const u = useContext(Ctx);
  if (!u) throw new Error('useUser fuera de SessionProvider');
  return u;
}

/** El backend decide; la interfaz solo oculta lo que el rol no puede hacer. */
export const canOperate = (u: User) => u.role === 'ADMIN' || u.role === 'OPERADOR';
