import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountCard } from '@/components/AccountCard';
import { Amount } from '@/components/Amount';
import { MovementList } from '@/components/MovementList';
import { listAccounts, listMovements } from '@/lib/ledger';
import { openAccountAction } from './actions';

export const metadata: Metadata = { title: 'Inicio' };

export default async function InicioPage() {
  const accounts = await listAccounts();

  if (accounts.length === 0) {
    return (
      <section className="panel form" aria-labelledby="bienvenida">
        <h1 id="bienvenida">Bienvenido a Ámbar</h1>
        <p className="muted">Abre tu cuenta de débito en pesos. Recibes una CLABE al instante para depósitos SPEI.</p>
        <form action={openAccountAction}>
          <button type="submit" className="btn btn-primary">
            Abrir mi cuenta
          </button>
        </form>
      </section>
    );
  }

  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  const primary = accounts[0];
  const recent = await listMovements(primary.id, { limit: 6 });

  return (
    <>
      <section className="panel balance" aria-labelledby="saldo-total">
        <h1 id="saldo-total" className="eyebrow">
          Saldo disponible
        </h1>
        <div aria-live="polite">
          <Amount centavos={total} className="amount-xl" />
        </div>
        <p className="muted">
          {accounts.length === 1 ? 'En tu cuenta de débito' : `En tus ${accounts.length} cuentas`}
        </p>
        <div className="actions">
          <Link className="btn btn-primary" href="/transferir">
            Transferir
          </Link>
          <Link className="btn" href={`/cuentas/${primary.id}`}>
            Ver movimientos
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="mis-cuentas">
        <div className="section-head">
          <h2 id="mis-cuentas">Mis cuentas</h2>
          <form action={openAccountAction}>
            <button type="submit" className="btn btn-quiet">
              Abrir otra cuenta
            </button>
          </form>
        </div>
        <div className="accounts">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="recientes">
        <div className="section-head">
          <h2 id="recientes">Movimientos recientes</h2>
          <Link href={`/cuentas/${primary.id}`}>Ver todos</Link>
        </div>
        <div className="panel">
          <MovementList movements={recent?.data ?? []} />
        </div>
      </section>
    </>
  );
}
