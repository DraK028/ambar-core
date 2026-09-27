import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AccountsService } from '../../src/application/accounts.service';
import { LedgerService } from '../../src/application/ledger.service';
import type { AccountView } from '../../src/application/views';
import { createPool } from '../../src/infrastructure/db';

export function testPool(max = 25): Pool {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST no está definida; la define global-setup.ts.');
  return createPool(url, max);
}

/** Dueño único por prueba: las pruebas no comparten datos y no hace falta limpiar tablas. */
export function newOwner(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}`;
}

export interface Fixture {
  pool: Pool;
  accounts: AccountsService;
  ledger: LedgerService;
  /** Abre una cuenta para un dueño nuevo y la fondea si se indica un saldo inicial. */
  customer(initialBalance?: number): Promise<{ owner: string; account: AccountView }>;
  balance(accountId: string): Promise<number>;
}

export function fixture(pool: Pool): Fixture {
  const accounts = new AccountsService(pool);
  const ledger = new LedgerService(pool);
  return {
    pool,
    accounts,
    ledger,
    async customer(initialBalance = 0) {
      const owner = newOwner();
      const account = await accounts.open(owner);
      if (initialBalance > 0) {
        await ledger.deposit({ idempotencyKey: randomUUID(), accountId: account.id, amount: initialBalance, concept: 'Fondeo de prueba' });
      }
      return { owner, account };
    },
    async balance(accountId: string) {
      const { rows } = await pool.query<{ balance: number }>('SELECT balance FROM ledger.accounts WHERE id = $1', [accountId]);
      return rows[0].balance;
    },
  };
}
