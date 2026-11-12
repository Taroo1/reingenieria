import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'MundoGlobal Travel - Operaciones', description: 'Dashboard operativo del motor orquestador' };

export const viewport: Viewport = { themeColor: '#0b1120', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
