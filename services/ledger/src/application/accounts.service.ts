import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { buildAmbarClabe } from '../domain/clabe';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { EntryKind } from '../domain/journal-entry';
import { PG_POOL, withTransaction } from '../infrastructure/db';
import { findAccountById } from '../infrastructure/queries';
import { ACCOUNT_COLUMNS, AccountRow, toAccount } from '../infrastructure/rows';
import { AccountView, MovementPage, toAccountView } from './views';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

@Injectable()
export class AccountsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Abre una cuenta de débito en MXN con una CLABE nueva y registra `account.opened`. */
  async open(ownerId: string): Promise<AccountView> {
    return withTransaction(this.pool, async (c) => {
      const { rows: seq } = await c.query<{ n: number }>(`SELECT nextval('ledger.clabe_account_seq') AS n`);
      const clabe = buildAmbarClabe(seq[0].n);
      const { rows } = await c.query<AccountRow>(
        `INSERT INTO ledger.accounts (owner_id, clabe, kind, normal_side)
         VALUES ($1, $2, 'CUSTOMER', 'CREDIT')
         RETURNING ${ACCOUNT_COLUMNS}`,
        [ownerId, clabe],
      );
      const account = toAccount(rows[0]);
      await c.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'account.opened', $2)`, [
        account.id,
        { account_id: account.id, owner_id: ownerId, occurred_at: account.createdAt.toISOString() },
      ]);
      return toAccountView(account);
    });
  }

  async listForOwner(ownerId: string): Promise<AccountView[]> {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM ledger.accounts
        WHERE owner_id = $1 AND kind = 'CUSTOMER'
        ORDER BY created_at, id`,
      [ownerId],
    );
    return rows.map((r) => toAccountView(toAccount(r)));
  }

  /** Devuelve la cuenta solo si pertenece al usuario; si no, 404 (protección BOLA). */
  async getForOwner(accountId: string, ownerId: string): Promise<AccountView> {
    const account = await findAccountById(this.pool, accountId);
    if (!account || account.kind !== 'CUSTOMER' || account.ownerId !== ownerId) {
      throw new NotFoundError('account');
    }
    return toAccountView(account);
  }

  /**
   * Movimientos con paginación por cursor (id del posting, descendente).
   * El monto se expresa desde la perspectiva del cliente: positivo = abono.
   */
  async movements(accountId: string, ownerId: string, limit = DEFAULT_PAGE_SIZE, cursor?: string): Promise<MovementPage> {
    await this.getForOwner(accountId, ownerId);
    const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const { rows } = await this.pool.query<{
      id: number;
      entry_id: string;
      kind: EntryKind;
      description: string;
      amount: number;
      created_at: Date;
    }>(
      `SELECT p.id, p.entry_id, e.kind, e.description, -p.amount AS amount, p.created_at
         FROM ledger.postings p
         JOIN ledger.journal_entries e ON e.id = p.entry_id
        WHERE p.account_id = $1
          AND ($2::bigint IS NULL OR p.id < $2::bigint)
        ORDER BY p.id DESC
        LIMIT $3`,
      [accountId, cursor ?? null, size + 1],
    );
    const page = rows.slice(0, size);
    return {
      data: page.map((r) => ({
        id: String(r.id),
        entry_id: r.entry_id,
        kind: r.kind,
        description: r.description,
        amount: r.amount,
        created_at: r.created_at.toISOString(),
      })),
      next_cursor: rows.length > size ? String(page[page.length - 1].id) : null,
    };
  }

  /**
   * Operación: descongela una cuenta después de revisar el caso. Queda auditado en el outbox
   * (account.unfrozen con el operador y el motivo).
   */
  async unfreeze(actor: string, accountId: string, reason: string): Promise<AccountView> {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new ValidationError('El motivo es obligatorio.', [{ path: 'reason', message: 'mínimo 3 caracteres' }]);
    }
    return withTransaction(this.pool, async (c) => {
      const { rows } = await c.query<AccountRow>(
        `UPDATE ledger.accounts SET status = 'ACTIVE', version = version + 1
          WHERE id = $1 AND kind = 'CUSTOMER' AND status = 'FROZEN'
          RETURNING ${ACCOUNT_COLUMNS}`,
        [accountId],
      );
      if (rows[0]) {
        await c.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'account.unfrozen', $2)`, [
          accountId,
          { account_id: accountId, owner_id: rows[0].owner_id, actor, reason: trimmed, occurred_at: new Date().toISOString() },
        ]);
        return toAccountView(toAccount(rows[0]));
      }
      const current = await findAccountById(c, accountId);
      if (!current || current.kind !== 'CUSTOMER') throw new NotFoundError('account');
      return toAccountView(current); // ya estaba activa (o cerrada): idempotente
    });
  }
}
