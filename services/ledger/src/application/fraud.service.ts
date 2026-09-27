import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { FraudCaseClosedError, NotFoundError, ValidationError } from '../domain/errors';
import { formatMXN } from '../domain/money';
import type { RiskAssessment, RiskReason } from '../domain/risk';
import { PG_POOL, withTransaction } from '../infrastructure/db';
import type { Queryable } from '../infrastructure/queries';
import { insertNotification, pushTokensFor, type NotificationView } from './notifications.service';

export type FraudCaseStatus = 'OPEN' | 'RECOGNIZED' | 'NOT_RECOGNIZED';

/** Lo que ve el cliente: los motivos sí, el puntaje no (no se le enseña a un atacante dónde está el umbral). */
export interface FraudCaseView {
  id: string;
  status: FraudCaseStatus;
  reasons: RiskReason[];
  created_at: string;
  resolved_at: string | null;
  transfer: {
    entry_id: string;
    amount: number;
    concept: string;
    destination_clabe_last4: string;
    created_at: string;
  };
}

interface CaseRow {
  id: string;
  entry_id: string;
  account_id: string;
  owner_id: string;
  score: number;
  reasons: RiskReason[];
  status: FraudCaseStatus;
  created_at: Date;
  resolved_at: Date | null;
  amount: string;
  concept: string;
  destination_clabe: string;
  entry_created_at: Date;
}

const CASE_QUERY = `
  SELECT fc.id, fc.entry_id, fc.account_id, fc.owner_id, fc.score, fc.reasons, fc.status, fc.created_at, fc.resolved_at,
         e.metadata ->> 'amount' AS amount, e.metadata ->> 'concept' AS concept, d.clabe AS destination_clabe,
         e.created_at AS entry_created_at
    FROM customer.fraud_cases fc
    JOIN ledger.journal_entries e ON e.id = fc.entry_id
    JOIN ledger.accounts d ON d.id = (e.metadata ->> 'destination_account_id')::uuid`;

function toView(r: CaseRow): FraudCaseView {
  return {
    id: r.id,
    status: r.status,
    reasons: r.reasons,
    created_at: r.created_at.toISOString(),
    resolved_at: r.resolved_at ? r.resolved_at.toISOString() : null,
    transfer: {
      entry_id: r.entry_id,
      amount: Number(r.amount),
      concept: r.concept,
      destination_clabe_last4: r.destination_clabe.slice(-4),
      created_at: r.entry_created_at.toISOString(),
    },
  };
}

async function findCase(q: Queryable, where: string, params: unknown[], lock = false): Promise<CaseRow | null> {
  // FOR UPDATE OF fc: solo se bloquea el caso, no el asiento ni las cuentas.
  const { rows } = await q.query<CaseRow>(`${CASE_QUERY} WHERE ${where}${lock ? ' FOR UPDATE OF fc' : ''}`, params);
  return rows[0] ?? null;
}

@Injectable()
export class FraudService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * API interna (n8n): abre un caso para una transferencia. Los datos (cuenta, usuario, puntaje)
   * salen del asiento, no de la solicitud: n8n solo decide *cuándo* preguntar.
   * El aviso al cliente se crea en la misma transacción, con un texto fijo del core.
   */
  async open(entryId: string): Promise<{
    fraud_case: FraudCaseView & { score: number; account_id: string };
    created: boolean;
    notification: NotificationView;
    push_tokens: string[];
  }> {
    return withTransaction(this.pool, async (c) => {
      const { rows: entries } = await c.query<{ kind: string; metadata: Record<string, unknown> }>(
        'SELECT kind, metadata FROM ledger.journal_entries WHERE id = $1',
        [entryId],
      );
      const entry = entries[0];
      if (!entry) throw new NotFoundError('entry');
      if (entry.kind !== 'TRANSFER') {
        throw new ValidationError('Solo se abren casos de fraude sobre transferencias.', [{ path: 'entry_id', message: 'no es una transferencia' }]);
      }
      const m = entry.metadata as { source_account_id: string; initiated_by: string; amount: number; risk?: RiskAssessment };
      const risk = m.risk ?? { score: 0, reasons: [] };

      const inserted = await c.query<{ id: string }>(
        `INSERT INTO customer.fraud_cases (entry_id, account_id, owner_id, score, reasons)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entry_id) DO NOTHING
         RETURNING id`,
        [entryId, m.source_account_id, m.initiated_by, risk.score, risk.reasons],
      );
      const row = (await findCase(c, 'fc.entry_id = $1', [entryId]))!;
      const { notification } = await insertNotification(c, {
        eventId: row.id,
        kind: 'FRAUD_CHECK',
        ownerId: row.owner_id,
        title: '¿Reconoces esta transferencia?',
        body: `Enviaste ${formatMXN(Number(row.amount))} a la cuenta terminación ${row.destination_clabe.slice(-4)}. Confírmalo en la app; si no fuiste tú, congelaremos tu cuenta.`,
        data: { fraud_case_id: row.id, entry_id: row.entry_id, account_id: row.account_id },
      });
      return {
        fraud_case: { ...toView(row), score: row.score, account_id: row.account_id },
        created: inserted.rowCount === 1,
        notification,
        push_tokens: await pushTokensFor(c, row.owner_id),
      };
    });
  }

  async getForOwner(ownerId: string, caseId: string): Promise<FraudCaseView> {
    const row = await findCase(this.pool, 'fc.id = $1 AND fc.owner_id = $2', [caseId, ownerId]);
    if (!row) throw new NotFoundError('fraud_case');
    return toView(row);
  }

  /**
   * Respuesta del cliente. Si no reconoce la transferencia, la cuenta de origen se congela aquí
   * mismo, en la misma transacción: la protección no depende de que n8n esté disponible.
   * n8n recibe fraud_case.answered y se encarga del seguimiento (avisos, alerta a operaciones).
   */
  async answer(ownerId: string, caseId: string, recognized: boolean): Promise<FraudCaseView & { account_frozen: boolean }> {
    const status: FraudCaseStatus = recognized ? 'RECOGNIZED' : 'NOT_RECOGNIZED';
    return withTransaction(this.pool, async (c) => {
      const current = await findCase(c, 'fc.id = $1 AND fc.owner_id = $2', [caseId, ownerId], true);
      if (!current) throw new NotFoundError('fraud_case');
      if (current.status !== 'OPEN') {
        if (current.status !== status) throw new FraudCaseClosedError();
        const { rows } = await c.query<{ status: string }>('SELECT status FROM ledger.accounts WHERE id = $1', [current.account_id]);
        return { ...toView(current), account_frozen: rows[0].status === 'FROZEN' };
      }

      await c.query(`UPDATE customer.fraud_cases SET status = $2, resolved_at = now() WHERE id = $1`, [caseId, status]);

      let frozen = false;
      if (!recognized) {
        const res = await c.query(
          `UPDATE ledger.accounts SET status = 'FROZEN', version = version + 1 WHERE id = $1 AND status = 'ACTIVE'`,
          [current.account_id],
        );
        const { rows } = await c.query<{ status: string }>('SELECT status FROM ledger.accounts WHERE id = $1', [current.account_id]);
        frozen = rows[0].status === 'FROZEN';
        if (res.rowCount === 1) {
          await c.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'account.frozen', $2)`, [
            current.account_id,
            {
              account_id: current.account_id,
              owner_id: ownerId,
              reason: 'FRAUD_NOT_RECOGNIZED',
              fraud_case_id: caseId,
              occurred_at: new Date().toISOString(),
            },
          ]);
        }
      }

      await c.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'fraud_case.answered', $2)`, [
        caseId,
        {
          fraud_case_id: caseId,
          entry_id: current.entry_id,
          account_id: current.account_id,
          owner_id: ownerId,
          recognized,
          account_frozen: frozen,
          amount: Number(current.amount),
          score: current.score,
          reasons: current.reasons,
          occurred_at: new Date().toISOString(),
        },
      ]);

      const updated = (await findCase(c, 'fc.id = $1', [caseId]))!;
      return { ...toView(updated), account_frozen: frozen };
    });
  }
}
