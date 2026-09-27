import { AccountNotActiveError, InsufficientFundsError } from './errors';
import type { EntryKind } from './journal-entry';

export type AccountKind = 'CUSTOMER' | 'SYSTEM';
export type NormalSide = 'DEBIT' | 'CREDIT';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface Account {
  id: string;
  ownerId: string | null;
  code: string | null;
  clabe: string | null;
  kind: AccountKind;
  normalSide: NormalSide;
  currency: string;
  status: AccountStatus;
  allowNegative: boolean;
  /** Saldo en su lado normal, en centavos. Para cuentas de cliente es el saldo disponible. */
  balance: number;
  version: number;
  createdAt: Date;
}

/**
 * Cuánto cambia el saldo (en su lado normal) cuando la cuenta recibe un posting.
 * Postings: débito > 0, crédito < 0.
 *   - Cuenta de saldo acreedor (cliente): un crédito aumenta el saldo → delta = -amount
 *   - Cuenta de saldo deudor (liquidación): un débito aumenta el saldo → delta = amount
 */
export function balanceDelta(normalSide: NormalSide, postingAmount: number): number {
  return normalSide === 'CREDIT' ? -postingAmount : postingAmount;
}

/**
 * Aplica un cambio de saldo y valida las reglas de la cuenta.
 *
 * Reglas de estado:
 *   - CLOSED: no acepta movimientos.
 *   - FROZEN: puede recibir dinero pero no enviarlo, salvo un reverso
 *     (p. ej. regresar una transferencia fraudulenta desde una cuenta congelada).
 */
export function applyDelta(account: Account, delta: number, kind: EntryKind): number {
  if (account.status === 'CLOSED') {
    throw new AccountNotActiveError(account.id, account.status);
  }
  if (account.status === 'FROZEN' && delta < 0 && kind !== 'REVERSAL') {
    throw new AccountNotActiveError(account.id, account.status);
  }
  const next = account.balance + delta;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`Desbordamiento de saldo en la cuenta ${account.id}`);
  }
  if (!account.allowNegative && next < 0) {
    throw new InsufficientFundsError(account.id);
  }
  return next;
}
