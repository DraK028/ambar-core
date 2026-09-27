import type { Account } from '@ambar/api-client';
import Link from 'next/link';
import { formatClabe, lastFour } from '@ambar/banking-rules';
import { Amount } from './Amount';
import { CopyButton } from './CopyButton';

const STATUS: Record<Account['status'], string> = { ACTIVE: 'Activa', FROZEN: 'Congelada', CLOSED: 'Cerrada' };

export function AccountCard({ account }: { account: Account }) {
  return (
    <article className="panel account" aria-labelledby={`acc-${account.id}`}>
      <div className="account-row">
        <h3 id={`acc-${account.id}`}>
          <Link href={`/cuentas/${account.id}`}>Cuenta Débito ••{lastFour(account.clabe)}</Link>
        </h3>
        <span className={`status status-${account.status}`}>{STATUS[account.status]}</span>
      </div>
      <Amount centavos={account.balance} className="amount-lg" />
      <div className="clabe">
        <span className="muted">CLABE</span>
        <span className="mono">{formatClabe(account.clabe)}</span>
        <CopyButton value={account.clabe} label={`Copiar CLABE de la cuenta terminación ${lastFour(account.clabe)}`} />
      </div>
    </article>
  );
}
