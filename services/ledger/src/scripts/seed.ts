import { randomUUID } from 'node:crypto';
import { AccountsService } from '../application/accounts.service';
import { LedgerService } from '../application/ledger.service';
import { formatClabe } from '../domain/clabe';
import { formatMXN } from '../domain/money';
import { loadDbConfig } from '../config';
import { createPoolFromConfig } from '../infrastructure/db';
import { runMigrations } from '../infrastructure/migrate';
import { mintDevToken } from './mint-dev-token';

/**
 * Datos de demostración para local y staging:
 * dos clientes (Ana y Luis), un depósito SPEI simulado y una transferencia.
 */
async function main(): Promise<void> {
  const pool = createPoolFromConfig(loadDbConfig(), 4);
  try {
    await runMigrations(pool);
    const accounts = new AccountsService(pool);
    const ledger = new LedgerService(pool);

    const ana = await accounts.open('demo-ana');
    const luis = await accounts.open('demo-luis');
    await ledger.deposit({ idempotencyKey: randomUUID(), accountId: ana.id, amount: 2_500_000, concept: 'Nómina quincena' });
    await ledger.transfer({
      userId: 'demo-ana',
      idempotencyKey: randomUUID(),
      sourceAccountId: ana.id,
      destinationClabe: luis.clabe,
      amount: 45_000,
      concept: 'Tacos del viernes',
    });

    const [a, l] = await Promise.all([accounts.getForOwner(ana.id, 'demo-ana'), accounts.getForOwner(luis.id, 'demo-luis')]);
    console.log('Cuentas de demostración');
    console.log(`  Ana   ${a.id}  CLABE ${formatClabe(a.clabe)}  saldo ${formatMXN(a.balance)}`);
    console.log(`  Luis  ${l.id}  CLABE ${formatClabe(l.clabe)}  saldo ${formatMXN(l.balance)}`);
    if (process.env.LOCAL_JWT_SECRET) {
      console.log('\nToken de Ana (1 h):');
      console.log(await mintDevToken('demo-ana'));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
