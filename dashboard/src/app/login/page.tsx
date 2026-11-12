'use client';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/icons';
import { Button, Callout, Field } from '@/components/ui';

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mgt-csrf': '1' },
      body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError('No se pudo contactar al servidor');
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      return setError(res.status === 429 ? 'Demasiados intentos: espere un minuto' : (j?.error?.message ?? 'Credenciales invalidas'));
    }
    const next = params.get('next');
    window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark"><BrandMark size={22} /></span>
          <strong>MundoGlobal Travel</strong>
        </div>
        <div className="card">
          <h1>Iniciar sesion</h1>
          <p className="lead">Consola de operaciones del motor orquestador.</p>
          <form onSubmit={submit}>
            <Field label="Correo electronico" required>
              <input className="input" name="email" type="email" autoComplete="username" required autoFocus placeholder="nombre@empresa.com" />
            </Field>
            <Field label="Contrasena" required>
              <input className="input" name="password" type="password" autoComplete="current-password" required />
            </Field>
            {error && <Callout tone="bad" flush>{error}</Callout>}
            <Button type="submit" variant="primary" size="lg" block loading={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</Button>
          </form>
        </div>
        <p className="auth-foot">Acceso restringido a personal autorizado. La sesion se protege con cookies httpOnly.</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
