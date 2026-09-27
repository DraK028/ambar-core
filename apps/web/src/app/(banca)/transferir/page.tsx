import type { Metadata } from 'next';
import Link from 'next/link';
import { listAccounts } from '@/lib/ledger';
import { TransferForm } from './TransferForm';

export const metadata: Metadata = { title: 'Transferir' };

export default async function TransferirPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const { de } = await searchParams;
  const accounts = (await listAccounts()).filter((a) => a.status === 'ACTIVE');

  if (accounts.length === 0) {
    return (
      <section className="panel form">
        <h1>Transferir</h1>
        <p className="muted">Necesitas una cuenta activa para transferir.</p>
        <Link className="btn btn-primary" href="/inicio">
          Ir al inicio
        </Link>
      </section>
    );
  }
  const initialSource = accounts.some((a) => a.id === de) ? de! : accounts[0].id;
  return <TransferForm accounts={accounts} initialSource={initialSource} />;
}
