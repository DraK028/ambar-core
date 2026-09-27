import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Amount } from '@/components/Amount';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session/session';

export const metadata: Metadata = { title: 'Entrar' };

const REASONS: Record<string, { text: string; tone: 'notice' | 'alert' }> = {
  expirada: { text: 'Tu sesión terminó. Vuelve a iniciar sesión para continuar.', tone: 'notice' },
  inactividad: { text: 'Cerramos tu sesión por inactividad para proteger tu cuenta.', tone: 'notice' },
  salida: { text: 'Cerraste sesión. Hasta pronto.', tone: 'notice' },
  rechazado: { text: 'No se completó el inicio de sesión. Intenta de nuevo.', tone: 'alert' },
  intento: { text: 'El intento de inicio de sesión expiró o no es válido. Vuelve a empezar.', tone: 'alert' },
  error: { text: 'No pudimos iniciar tu sesión en este momento. Intenta de nuevo en unos minutos.', tone: 'alert' },
  usuario: { text: 'Elige un usuario de demostración válido.', tone: 'alert' },
};

const DEMO_USERS = [
  { id: 'demo-ana', name: 'Ana', note: 'Con saldo y movimientos (npm run seed)' },
  { id: 'demo-luis', name: 'Luis', note: 'Cuenta destino para probar transferencias' },
];

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ motivo?: string; returnTo?: string }> }) {
  if (await getSession({ touch: false })) redirect('/inicio');
  const { motivo, returnTo } = await searchParams;
  const reason = motivo ? REASONS[motivo] : undefined;
  const c = config();
  const loginHref = `/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;

  return (
    <div className="login">
      <aside className="login-art" aria-hidden="true">
        <Amount centavos={2_455_000} className="amount-xl" />
        <p>Tu dinero en pesos, al centavo. Cada movimiento queda registrado en un ledger de doble partida que nunca se borra.</p>
      </aside>
      <main className="login-main" id="contenido">
        <div className="brand">
          Ámbar<span>.</span>
        </div>
        <div className="section">
          <h1>Entra a tu banca en línea</h1>
          <p className="muted">Consulta tus cuentas, revisa tus movimientos y transfiere a otras cuentas Ámbar.</p>
        </div>

        {reason && (
          <p className={reason.tone} role={reason.tone === 'alert' ? 'alert' : 'status'}>
            {reason.text}
          </p>
        )}

        {c.AUTH_PROVIDER === 'cognito' ? (
          <a className="btn btn-primary btn-block" href={loginHref}>
            Iniciar sesión
          </a>
        ) : (
          <div className="section">
            <p className="notice">
              <strong>Modo local.</strong> Sin Cognito: elige un usuario de demostración. Este modo no existe fuera de tu máquina.
            </p>
            <form action="/api/auth/local" method="post" className="demo-users">
              {DEMO_USERS.map((u) => (
                <button key={u.id} type="submit" name="user" value={u.id} className="btn">
                  <span>
                    <strong>Entrar como {u.name}</strong> <span className="muted">· {u.note}</span>
                  </span>
                </button>
              ))}
            </form>
            {c.SHOW_DEMO_USERS && (
              <form action="/api/auth/local" method="post" className="field">
                <label htmlFor="user">Otro usuario de prueba</label>
                <input id="user" name="user" className="input" autoComplete="off" pattern="[a-z0-9][a-z0-9\-]{2,63}" required />
                <button className="btn" type="submit">
                  Entrar como este usuario
                </button>
              </form>
            )}
          </div>
        )}
        <p className="muted hint">Proyecto de portafolio. No uses datos ni dinero reales.</p>
      </main>
    </div>
  );
}
