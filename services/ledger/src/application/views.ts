import type { Account } from '../domain/account';
import type { EntryKind } from '../domain/journal-entry';

/** Representaciones públicas, con los mismos nombres que el contrato OpenAPI. */

export interface AccountView {
  id: string;
  clabe: string;
  currency: 'MXN';
  status: Account['status'];
  balance: number;
  created_at: string;
}

export interface PostingView {
  account_id: string;
  amount: number;
}

export interface EntryView {
  id: string;
  kind: EntryKind;
  description: string;
  reverses_id: string | null;
  created_at: string;
  postings: PostingView[];
}

export interface TransferView {
  id: string;
  status: 'POSTED';
  source_account_id: string;
  destination_account_id: string;
  amount: number;
  currency: 'MXN';
  concept: string;
  created_at: string;
}

export interface MovementView {
  id: string;
  entry_id: string;
  kind: EntryKind;
  description: string;
  amount: number;
  created_at: string;
}

export interface MovementPage {
  data: MovementView[];
  next_cursor: string | null;
}

export function toAccountView(a: Account): AccountView {
  if (a.kind !== 'CUSTOMER' || !a.clabe) {
    throw new Error('Solo las cuentas de cliente tienen representación pública.');
  }
  return {
    id: a.id,
    clabe: a.clabe,
    currency: 'MXN',
    status: a.status,
    balance: a.balance,
    created_at: a.createdAt.toISOString(),
  };
}

/** Resultado de una operación idempotente: la vista y si fue una repetición. */
export interface Idempotent<T> {
  value: T;
  replayed: boolean;
}
