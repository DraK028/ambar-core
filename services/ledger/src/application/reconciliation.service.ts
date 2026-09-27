import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../infrastructure/db';

export interface BalanceDrift {
  id: string;
  code: string | null;
  clabe: string | null;
  stored_balance: number;
  derived_balance: number;
}

export interface ReconciliationReport {
  checked_at: string;
  accounts_checked: number;
  drift: BalanceDrift[];
  /** Suma de todos los postings; en un ledger sano siempre es 0. */
  ledger_total: number;
  ok: boolean;
}

/**
 * Verificación de integridad: el saldo guardado en cada cuenta debe ser igual
 * al que se deriva de sus postings, y la suma global del ledger debe ser 0.
 * Pensado para correr cada noche (EventBridge Scheduler) y alertar si falla.
 */
@Injectable()
export class ReconciliationService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async run(): Promise<ReconciliationReport> {
    const client = await this.pool.connect();
    try {
      // Una sola instantánea consistente para las tres consultas.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const drift = await client.query<BalanceDrift>(
        'SELECT id, code, clabe, stored_balance, derived_balance FROM ledger.balance_drift ORDER BY id',
      );
      const total = await client.query<{ total: number }>('SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM ledger.postings');
      const count = await client.query<{ n: number }>('SELECT COUNT(*)::bigint AS n FROM ledger.accounts');
      await client.query('COMMIT');
      const ledgerTotal = total.rows[0].total;
      return {
        checked_at: new Date().toISOString(),
        accounts_checked: count.rows[0].n,
        drift: drift.rows,
        ledger_total: ledgerTotal,
        ok: drift.rows.length === 0 && ledgerTotal === 0,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Salud de la publicación de eventos: pendientes, muertos y antigüedad del más viejo. */
  async outboxHealth(): Promise<OutboxHealth> {
    const { rows } = await this.pool.query<OutboxHealth>(
      `SELECT COUNT(*) FILTER (WHERE published_at IS NULL AND dead_at IS NULL)::int AS pending,
              COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead,
              COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at) FILTER (WHERE published_at IS NULL AND dead_at IS NULL)), 0)::int
                AS oldest_pending_seconds
         FROM ledger.outbox`,
    );
    return rows[0];
  }

  /** Reporte completo para la conciliación diaria de n8n. */
  async fullReport(maxPendingSeconds = OUTBOX_MAX_LAG_SECONDS): Promise<{ checked_at: string; ok: boolean; ledger: ReconciliationReport; outbox: OutboxHealth }> {
    const [ledger, outbox] = await Promise.all([this.run(), this.outboxHealth()]);
    return {
      checked_at: ledger.checked_at,
      ok: ledger.ok && outbox.dead === 0 && outbox.oldest_pending_seconds <= maxPendingSeconds,
      ledger,
      outbox,
    };
  }
}

export interface OutboxHealth {
  pending: number;
  dead: number;
  oldest_pending_seconds: number;
}

/** Un evento sin publicar por más de 5 minutos indica que el relay o EventBridge fallan. */
export const OUTBOX_MAX_LAG_SECONDS = 300;
