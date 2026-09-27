import type { Account } from '../domain/account';
import type { EntryKind } from '../domain/journal-entry';

export interface AccountRow {
  id: string;
  owner_id: string | null;
  code: string | null;
  clabe: string | null;
  kind: Account['kind'];
  normal_side: Account['normalSide'];
  currency: string;
  status: Account['status'];
  allow_negative: boolean;
  balance: number;
  version: number;
  created_at: Date;
}

export const ACCOUNT_COLUMNS =
  'id, owner_id, code, clabe, kind, normal_side, currency, status, allow_negative, balance, version, created_at';

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    ownerId: row.owner_id,
    code: row.code,
    clabe: row.clabe,
    kind: row.kind,
    normalSide: row.normal_side,
    currency: row.currency.trim(),
    status: row.status,
    allowNegative: row.allow_negative,
    balance: row.balance,
    version: row.version,
    createdAt: row.created_at,
  };
}

export interface EntryRow {
  id: string;
  idempotency_key: string;
  request_hash: string;
  kind: EntryKind;
  description: string;
  reverses_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface PostingRow {
  id: number;
  entry_id: string;
  account_id: string;
  amount: number;
  currency: string;
}
