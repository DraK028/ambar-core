import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';

// Banca en línea: nada se prerenderiza ni se guarda en caché; cada respuesta es por usuario.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Ámbar · Banca en línea', template: '%s · Ámbar' },
  description: 'Consulta tus cuentas y transfiere en pesos con Ámbar.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#161d20' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
