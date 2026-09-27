import { toEnvelope } from '@ambar/events';
import type { Pool, PoolClient } from 'pg';
import type { Publisher } from './publishers';

export interface RelayOptions {
  batchSize: number;
  /** Intentos antes de apartar el evento como muerto (dead_at). */
  maxAttempts: number;
  /** Espera máxima entre revisiones si no llega ninguna notificación. */
  pollIntervalMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export const DEFAULT_RELAY_OPTIONS: RelayOptions = {
  batchSize: 50,
  maxAttempts: 10,
  pollIntervalMs: 5_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 10 * 60_000,
};

interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
  attempts: number;
}

export interface BatchResult {
  claimed: number;
  published: number;
  failed: number;
  dead: number;
}

/** 1 s, 2 s, 4 s, … con tope. Sin jitter aleatorio: el orden de reintento es predecible en pruebas. */
export function backoffMs(attempts: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** Math.max(0, attempts - 1));
}

/**
 * Relay del patrón outbox: publica los eventos que el core escribió en la misma
 * transacción que el cambio de negocio.
 *
 * - Entrega al menos una vez: si el proceso muere entre publicar y marcar, el evento se
 *   vuelve a publicar. Los consumidores deduplican por `id`.
 * - FOR UPDATE SKIP LOCKED: varias réplicas trabajan en paralelo sin tomar el mismo evento.
 * - LISTEN ledger_outbox: publica en milisegundos tras el COMMIT; el sondeo es solo respaldo.
 * - El orden es por created_at dentro de un lote, pero un evento que se reintenta puede
 *   quedar detrás de otros más nuevos: los consumidores no deben depender del orden global.
 */
export class OutboxRelay {
  private readonly opts: RelayOptions;
  private running = false;
  private wake: (() => void) | null = null;
  private listener: PoolClient | null = null;
  private loopDone: Promise<void> | null = null;
  lastLoopAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly publisher: Publisher,
    opts: Partial<RelayOptions> = {},
  ) {
    this.opts = { ...DEFAULT_RELAY_OPTIONS, ...opts };
  }

  /** Toma un lote, lo publica y registra el resultado. La transacción mantiene el bloqueo mientras publica. */
  async runOnce(): Promise<BatchResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, aggregate_id, event_type, payload, created_at, attempts
           FROM ledger.outbox
          WHERE published_at IS NULL AND dead_at IS NULL AND next_attempt_at <= now()
          ORDER BY created_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.opts.batchSize],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return { claimed: 0, published: 0, failed: 0, dead: 0 };
      }

      const results = await this.publisher.publish(rows.map(toEnvelope));
      const byId = new Map(results.map((r) => [r.id, r]));

      const ok: string[] = [];
      const retry: { id: string; attempts: number; delay: number; error: string; dead: boolean }[] = [];
      for (const row of rows) {
        const r = byId.get(row.id);
        if (r?.ok) {
          ok.push(row.id);
          continue;
        }
        const attempts = row.attempts + 1;
        retry.push({
          id: row.id,
          attempts,
          delay: backoffMs(attempts, this.opts.backoffBaseMs, this.opts.backoffMaxMs),
          error: (r?.error ?? 'sin resultado del publicador').slice(0, 500),
          dead: attempts >= this.opts.maxAttempts,
        });
      }

      if (ok.length) {
        await client.query('UPDATE ledger.outbox SET published_at = now(), last_error = NULL WHERE id = ANY($1::uuid[])', [ok]);
      }
      if (retry.length) {
        await client.query(
          `UPDATE ledger.outbox AS o
              SET attempts = r.attempts,
                  last_error = r.error,
                  next_attempt_at = now() + r.delay * interval '1 millisecond',
                  dead_at = CASE WHEN r.dead THEN now() END
             FROM unnest($1::uuid[], $2::int[], $3::int[], $4::text[], $5::bool[]) AS r(id, attempts, delay, error, dead)
            WHERE o.id = r.id`,
          [retry.map((r) => r.id), retry.map((r) => r.attempts), retry.map((r) => r.delay), retry.map((r) => r.error), retry.map((r) => r.dead)],
        );
      }
      await client.query('COMMIT');

      const dead = retry.filter((r) => r.dead);
      for (const d of dead) this.log('Evento apartado como muerto', { id: d.id, error: d.error });
      if (retry.length) this.log('Eventos con error, se reintentarán', { count: retry.length - dead.length });
      return { claimed: rows.length, published: ok.length, failed: retry.length, dead: dead.length };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Procesa lotes hasta vaciar lo que está listo para publicarse. */
  async drain(): Promise<BatchResult> {
    const total: BatchResult = { claimed: 0, published: 0, failed: 0, dead: 0 };
    for (;;) {
      const r = await this.runOnce();
      total.claimed += r.claimed;
      total.published += r.published;
      total.failed += r.failed;
      total.dead += r.dead;
      if (r.claimed < this.opts.batchSize || r.published === 0) return total;
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.listen();
    this.loopDone = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loopDone;
    if (this.listener) {
      await this.listener.query('UNLISTEN ledger_outbox').catch(() => undefined);
      this.listener.release();
      this.listener = null;
    }
  }

  private async listen(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.on('notification', () => this.wake?.());
      client.on('error', (err) => {
        // La conexión de LISTEN se cayó: se descarta y se reabre en la siguiente vuelta.
        this.log('Se perdió la conexión LISTEN; se usará sondeo hasta reconectar', { error: err.message });
        client.release(err);
        if (this.listener === client) this.listener = null;
      });
      await client.query('LISTEN ledger_outbox');
      this.listener = client;
    } catch (err) {
      this.log('No se pudo abrir LISTEN; se usará solo sondeo', { error: (err as Error).message });
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      this.lastLoopAt = Date.now();
      try {
        if (!this.listener) await this.listen();
        await this.drain();
      } catch (err) {
        this.log('Error en el relay', { error: (err as Error).message });
      }
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.opts.pollIntervalMs);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = null;
    }
  }

  private log(msg: string, extra?: Record<string, unknown>): void {
    this.opts.log?.(msg, extra);
  }
}
