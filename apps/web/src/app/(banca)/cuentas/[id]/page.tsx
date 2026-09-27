import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Amount } from '@/components/Amount';
import { CopyButton } from '@/components/CopyButton';
import { MovementList } from '@/components/MovementList';
import { formatClabe, lastFour } from '@ambar/banking-rules';
import { getAccount, listMovements } from '@/lib/ledger';

export const metadata: Metadata = { title: 'Movimientos' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 20;

export default async function CuentaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string; nueva?: string }>;
}) {
  const { id } = await params;
  const { cursor, nueva } = await searchParams;
  if (!UUID.test(id)) notFound();
  const validCursor = cursor && /^\d+$/.test(cursor) ? cursor : undefined;

  const [account, page] = await Promise.all([getAccount(id), listMovements(id, { cursor: validCursor, limit: PAGE })]);
  if (!account || !page) notFound();

  return (
    <>
      {nueva && (
        <p className="notice" role="status">
          Tu cuenta está lista. Comparte tu CLABE para recibir depósitos.
        </p>
      )}
      <section className="panel balance" aria-labelledby="cuenta-titulo">
        <p className="eyebrow">Cuenta Débito ••{lastFour(account.clabe)}</p>
        <h1 id="cuenta-titulo" className="sr-only">
          Cuenta terminación {lastFour(account.clabe)}
        </h1>
        <Amount centavos={account.balance} className="amount-xl" />
        <div className="clabe">
          <span className="muted">CLABE</span>
          <span className="mono">{formatClabe(account.clabe)}</span>
          <CopyButton value={account.clabe} label="Copiar CLABE" />
        </div>
        <div className="actions">
          <Link className="btn btn-primary" href={`/transferir?de=${account.id}`}>
            Transferir desde esta cuenta
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="movs">
        <h2 id="movs">{validCursor ? 'Movimientos anteriores' : 'Movimientos'}</h2>
        <div className="panel">
          <MovementList movements={page.data} />
          {(validCursor || page.next_cursor) && (
            <nav className="pager" aria-label="Paginación de movimientos">
              {validCursor ? <Link href={`/cuentas/${account.id}`}>Más recientes</Link> : <span />}
              {page.next_cursor && <Link href={`/cuentas/${account.id}?cursor=${page.next_cursor}`}>Ver anteriores</Link>}
            </nav>
          )}
        </div>
      </section>
    </>
  );
}
