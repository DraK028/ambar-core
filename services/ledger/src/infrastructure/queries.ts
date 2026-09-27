import type { Pool, PoolClient } from 'pg';
import type { Account } from '../domain/account';
import { ACCOUNT_COLUMNS, AccountRow, EntryRow, PostingRow, toAccount } from './rows';

export type Queryable = Pool | PoolClient;

export async function findAccountById(q: Queryable, id: string): Promise<Account | null> {
  const { rows } = await q.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM ledger.accounts WHERE id = $1`, [id]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function findAccountByClabe(q: Queryable, clabe: string): Promise<Account | null> {
  const { rows } = await q.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM ledger.accounts WHERE clabe = $1`, [clabe]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function findSystemAccount(q: Queryable, code: string): Promise<Account> {
  const { rows } = await q.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM ledger.accounts WHERE code = $1`, [code]);
  if (!rows[0]) {
    throw new Error(`Falta la cuenta de sistema ${code}; ¿corriste las migraciones?`);
  }
  return toAccount(rows[0]);
}

export async function findEntryById(q: Queryable, id: string): Promise<EntryRow | null> {
  const { rows } = await q.query<EntryRow>('SELECT * FROM ledger.journal_entries WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function findPostings(q: Queryable, entryId: string): Promise<PostingRow[]> {
  const { rows } = await q.query<PostingRow>(
    'SELECT id, entry_id, account_id, amount, currency FROM ledger.postings WHERE entry_id = $1 ORDER BY id',
    [entryId],
  );
  return rows;
}
