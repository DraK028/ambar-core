import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { applyDelta, balanceDelta } from '../domain/account';
import {
  AlreadyReversedError,
  IdempotencyKeyReusedError,
  InsufficientFundsError,
  NotFoundError,
  NotReversibleError,
  SameAccountError,
  UnbalancedEntryError,
  ValidationError,
} from '../domain/errors';
import {
  assertBalanced,
  depositPostings,
  EntryKind,
  PostingInput,
  reversalPostings,
  transferPostings,
} from '../domain/journal-entry';
import { assertOperationAmount } from '../domain/money';
import { assessTransferRisk, type RiskAssessment } from '../domain/risk';
import { PG_POOL, pgError, withTransaction } from '../infrastructure/db';
import {
  findAccountByClabe,
  findAccountById,
  findEntryById,
  findPostings,
  findSystemAccount,
} from '../infrastructure/queries';
import { ACCOUNT_COLUMNS, AccountRow, EntryRow, PostingRow, toAccount } from '../infrastructure/rows';
import { requestHash } from './request-hash';
import { STEP_UP_POLICY, StepUpService, type StepUpPolicy } from './step-up.service';
import { EntryView, Idempotent, TransferView } from './views';

export const SETTLEMENT_ACCOUNT_CODE = 'SPEI_SETTLEMENT';

export interface TransferCommand {
  userId: string;
  idempotencyKey: string;
  sourceAccountId: string;
  destinationClabe: string;
  amount: number;
  concept: string;
  /** app client de Cognito que emitió el token; decide si aplica la política de step-up. */
  clientId?: string | null;
  /** Header X-Step-Up, si la app ya firmó un reto. */
  stepUpProof?: string;
}

export interface DepositCommand {
  idempotencyKey: string;
  accountId: string;
  amount: number;
  concept: string;
}

export interface ReverseCommand {
  actor: string;
  idempotencyKey: string;
  entryId: string;
  reason: string;
}

interface PostEntryCommand {
  idempotencyKey: string;
  requestHash: string;
  kind: EntryKind;
  description: string;
  reversesId?: string | null;
  metadata: Record<string, unknown>;
  postings: PostingInput[];
  event: { type: string; payload: Record<string, unknown> };
}

interface StoredEntry {
  entry: EntryRow;
  postings: PostingRow[];
}

@Injectable()
export class LedgerService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() private readonly stepUp?: StepUpService,
    @Optional() @Inject(STEP_UP_POLICY) private readonly stepUpPolicy?: StepUpPolicy,
  ) {}

  /** Transferencia entre cuentas Ámbar. La cuenta de origen debe ser del usuario. */
  async transfer(cmd: TransferCommand): Promise<Idempotent<TransferView>> {
    assertOperationAmount(cmd.amount);
    assertConcept(cmd.concept);

    // La propiedad de una cuenta y su CLABE no cambian: se pueden leer fuera de la transacción.
    // El estado y el saldo sí cambian, y se validan bajo bloqueo dentro de postEntry.
    const source = await findAccountById(this.pool, cmd.sourceAccountId);
    if (!source || source.kind !== 'CUSTOMER' || source.ownerId !== cmd.userId) {
      throw new NotFoundError('account'); // 404 aunque exista: no se revela la cuenta de otro usuario
    }
    const destination = await findAccountByClabe(this.pool, cmd.destinationClabe);
    if (!destination || destination.kind !== 'CUSTOMER') {
      throw new NotFoundError('account');
    }
    if (destination.id === source.id) {
      throw new SameAccountError();
    }

    const body = {
      source_account_id: cmd.sourceAccountId,
      destination_clabe: cmd.destinationClabe,
      amount: cmd.amount,
      concept: cmd.concept,
    };
    const idempotencyKey = `transfer:${cmd.userId}:${cmd.idempotencyKey}`;

    // Un reintento de una transferencia ya registrada no vuelve a pedir biometría:
    // postEntry devuelve la respuesta original (o 409 si el cuerpo cambió).
    if (this.stepUp && this.stepUpPolicy && !(await this.entryExists(idempotencyKey))) {
      await this.stepUp.enforce(this.stepUpPolicy, {
        ownerId: cmd.userId,
        clientId: cmd.clientId ?? null,
        destinationAccountId: destination.id,
        operation: { type: 'transfer', ...body },
        proof: cmd.stepUpProof,
      });
    }

    const risk = await this.assessRisk(cmd.userId, destination.id, cmd.amount);

    const result = await this.postEntry({
      idempotencyKey,
      requestHash: requestHash('transfer', body),
      kind: 'TRANSFER',
      description: cmd.concept,
      metadata: {
        source_account_id: source.id,
        destination_account_id: destination.id,
        amount: cmd.amount,
        concept: cmd.concept,
        initiated_by: cmd.userId,
        risk,
      },
      postings: transferPostings(source.id, destination.id, cmd.amount),
      event: {
        type: 'transfer.posted',
        payload: {
          source_account_id: source.id,
          destination_account_id: destination.id,
          amount: cmd.amount,
          currency: 'MXN',
          risk,
        },
      },
    });
    return { value: toTransferView(result.value), replayed: result.replayed };
  }

  /** Depósito SPEI entrante simulado (solo entornos de QA). */
  async deposit(cmd: DepositCommand): Promise<Idempotent<EntryView>> {
    assertOperationAmount(cmd.amount);
    assertConcept(cmd.concept);

    const account = await findAccountById(this.pool, cmd.accountId);
    if (!account || account.kind !== 'CUSTOMER') {
      throw new NotFoundError('account');
    }
    const settlement = await findSystemAccount(this.pool, SETTLEMENT_ACCOUNT_CODE);

    const result = await this.postEntry({
      idempotencyKey: `deposit:${cmd.idempotencyKey}`,
      requestHash: requestHash('deposit', { account_id: cmd.accountId, amount: cmd.amount, concept: cmd.concept }),
      kind: 'DEPOSIT',
      description: cmd.concept,
      metadata: { account_id: account.id, amount: cmd.amount, channel: 'SPEI_SIMULATED' },
      postings: depositPostings(settlement.id, account.id, cmd.amount),
      event: { type: 'deposit.posted', payload: { account_id: account.id, amount: cmd.amount, currency: 'MXN' } },
    });
    return { value: toEntryView(result.value), replayed: result.replayed };
  }

  /** Registra el reverso de un asiento. El original queda intacto. */
  async reverse(cmd: ReverseCommand): Promise<Idempotent<EntryView>> {
    const reason = cmd.reason.trim();
    if (reason.length < 3) {
      throw new ValidationError('El motivo del reverso es obligatorio.', [{ path: 'reason', message: 'mínimo 3 caracteres' }]);
    }
    const original = await findEntryById(this.pool, cmd.entryId);
    if (!original) throw new NotFoundError('entry');
    if (original.kind === 'REVERSAL') throw new NotReversibleError();
    const originalPostings = await findPostings(this.pool, original.id);

    const result = await this.postEntry({
      idempotencyKey: `reversal:${cmd.idempotencyKey}`,
      requestHash: requestHash('reversal', { entry_id: cmd.entryId, reason }),
      kind: 'REVERSAL',
      description: `Reverso: ${reason}`,
      reversesId: original.id,
      metadata: { reason, actor: cmd.actor, original_kind: original.kind },
      postings: reversalPostings(originalPostings.map((p) => ({ accountId: p.account_id, amount: p.amount }))),
      event: { type: 'entry.reversed', payload: { reverses_id: original.id, reason } },
    });
    return { value: toEntryView(result.value), replayed: result.replayed };
  }

  /**
   * Señales de riesgo con el historial del usuario. Se leen fuera de la transacción:
   * es una estimación para alertar, no una regla que deba ser exacta bajo concurrencia.
   */
  private async assessRisk(userId: string, destinationAccountId: string, amount: number): Promise<RiskAssessment> {
    const { rows } = await this.pool.query<{ to_beneficiary: number; recent: number; average: number | null; now: Date }>(
      `SELECT COUNT(*) FILTER (WHERE metadata ->> 'destination_account_id' = $2)::int AS to_beneficiary,
              COUNT(*) FILTER (WHERE created_at > now() - interval '10 minutes')::int AS recent,
              AVG((metadata ->> 'amount')::bigint) FILTER (WHERE created_at > now() - interval '90 days')::float8 AS average,
              now() AS now
         FROM ledger.journal_entries
        WHERE kind = 'TRANSFER' AND metadata ->> 'initiated_by' = $1`,
      [userId, destinationAccountId],
    );
    const h = rows[0];
    return assessTransferRisk({
      amount,
      knownBeneficiary: h.to_beneficiary > 0,
      averageAmount: h.average,
      recentTransfers: h.recent,
      at: h.now,
    });
  }

  private async entryExists(idempotencyKey: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('SELECT 1 FROM ledger.journal_entries WHERE idempotency_key = $1', [idempotencyKey]);
    return (rowCount ?? 0) > 0;
  }

  async getEntry(entryId: string): Promise<EntryView> {
    const entry = await findEntryById(this.pool, entryId);
    if (!entry) throw new NotFoundError('entry');
    return toEntryView({ entry, postings: await findPostings(this.pool, entry.id) });
  }

  /**
   * Núcleo del ledger. En una sola transacción:
   *   1. Reserva la Idempotency-Key (si ya existe, devuelve el asiento original).
   *   2. Bloquea las cuentas en orden por id (evita deadlocks entre A→B y B→A).
   *   3. Valida estado y saldo de cada cuenta.
   *   4. Inserta los postings, actualiza saldos y escribe el evento en el outbox.
   * Al hacer COMMIT, Postgres vuelve a verificar que el asiento cuadre.
   */
  private async postEntry(cmd: PostEntryCommand): Promise<Idempotent<StoredEntry>> {
    assertBalanced(cmd.postings);
    try {
      return await withTransaction(this.pool, async (c) => {
        const inserted = await c.query<EntryRow>(
          `INSERT INTO ledger.journal_entries (idempotency_key, request_hash, kind, description, reverses_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING *`,
          [cmd.idempotencyKey, cmd.requestHash, cmd.kind, cmd.description, cmd.reversesId ?? null, cmd.metadata],
        );

        if (inserted.rowCount === 0) {
          return { value: await this.replay(c, cmd), replayed: true };
        }
        const entry = inserted.rows[0];

        const accountIds = [...new Set(cmd.postings.map((p) => p.accountId))];
        const locked = await c.query<AccountRow>(
          `SELECT ${ACCOUNT_COLUMNS} FROM ledger.accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
          [accountIds],
        );
        if (locked.rowCount !== accountIds.length) {
          throw new NotFoundError('account');
        }
        const accounts = new Map(locked.rows.map((r) => [r.id, toAccount(r)]));

        const deltas = new Map<string, number>();
        for (const p of cmd.postings) {
          const account = accounts.get(p.accountId)!;
          deltas.set(p.accountId, (deltas.get(p.accountId) ?? 0) + balanceDelta(account.normalSide, p.amount));
        }
        const ids: string[] = [];
        const balances: number[] = [];
        for (const [id, delta] of deltas) {
          ids.push(id);
          balances.push(applyDelta(accounts.get(id)!, delta, cmd.kind));
        }

        const postings = await c.query<PostingRow>(
          `INSERT INTO ledger.postings (entry_id, account_id, amount)
           SELECT $1::uuid, t.account_id, t.amount
             FROM unnest($2::uuid[], $3::bigint[]) AS t(account_id, amount)
           RETURNING id, entry_id, account_id, amount, currency`,
          [entry.id, cmd.postings.map((p) => p.accountId), cmd.postings.map((p) => p.amount)],
        );

        await c.query(
          `UPDATE ledger.accounts AS a
              SET balance = v.balance, version = a.version + 1
             FROM unnest($1::uuid[], $2::bigint[]) AS v(id, balance)
            WHERE a.id = v.id`,
          [ids, balances],
        );

        await c.query(
          `INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, $2, $3)`,
          [
            entry.id,
            cmd.event.type,
            { ...cmd.event.payload, entry_id: entry.id, occurred_at: entry.created_at.toISOString() },
          ],
        );

        return {
          value: { entry, postings: postings.rows.sort((a, b) => a.id - b.id) },
          replayed: false,
        };
      });
    } catch (err) {
      throw translatePgError(err);
    }
  }

  private async replay(c: PoolClient, cmd: PostEntryCommand): Promise<StoredEntry> {
    const { rows } = await c.query<EntryRow>('SELECT * FROM ledger.journal_entries WHERE idempotency_key = $1', [
      cmd.idempotencyKey,
    ]);
    const existing = rows[0];
    if (!existing || existing.request_hash !== cmd.requestHash) {
      throw new IdempotencyKeyReusedError();
    }
    return { entry: existing, postings: await findPostings(c, existing.id) };
  }
}

function assertConcept(concept: string): void {
  const trimmed = concept.trim();
  if (trimmed.length < 1 || concept.length > 40) {
    throw new ValidationError('El concepto debe tener entre 1 y 40 caracteres.', [
      { path: 'concept', message: 'entre 1 y 40 caracteres' },
    ]);
  }
}

function translatePgError(err: unknown): unknown {
  const { code, constraint } = pgError(err);
  if (code === '23505' && constraint === 'journal_entries_reverses_id_key') return new AlreadyReversedError();
  if (code === '23514' && constraint === 'accounts_balance_non_negative') return new InsufficientFundsError();
  if (code === '23514' && constraint === 'entry_must_balance') return new UnbalancedEntryError((err as Error).message);
  return err;
}

export function toEntryView({ entry, postings }: StoredEntry): EntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    description: entry.description,
    reverses_id: entry.reverses_id,
    created_at: entry.created_at.toISOString(),
    postings: postings.map((p) => ({ account_id: p.account_id, amount: p.amount })),
  };
}

export function toTransferView({ entry }: StoredEntry): TransferView {
  const m = entry.metadata as {
    source_account_id: string;
    destination_account_id: string;
    amount: number;
    concept: string;
  };
  return {
    id: entry.id,
    status: 'POSTED',
    source_account_id: m.source_account_id,
    destination_account_id: m.destination_account_id,
    amount: m.amount,
    currency: 'MXN',
    concept: m.concept,
    created_at: entry.created_at.toISOString(),
  };
}
