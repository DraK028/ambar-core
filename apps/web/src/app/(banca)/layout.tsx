import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/LogoutButton';
import { NavLinks } from '@/components/NavLinks';
import { SessionTimeout } from '@/components/SessionTimeout';
import { getSession } from '@/lib/session/session';

export default async function BancaLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/entrar?motivo=expirada');

  return (
    <div className="shell">
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <aside className="sidebar" aria-label="Menú principal">
        <Link className="brand" href="/inicio">
          Ámbar<span>.</span>
        </Link>
        <nav className="sidenav" aria-label="Secciones">
          <NavLinks />
          <LogoutButton />
        </nav>
        <p className="who">{session.email ?? session.sub}</p>
      </aside>

      <div>
        <header className="topbar">
          <Link className="brand" href="/inicio">
            Ámbar<span>.</span>
          </Link>
          <span className="muted hint">{session.email ?? session.sub}</span>
        </header>
        <main id="contenido" className="main" tabIndex={-1}>
          {children}
        </main>
        <nav className="tabbar" aria-label="Secciones">
          <NavLinks />
          <LogoutButton />
        </nav>
      </div>
      <SessionTimeout />
    </div>
  );
}
