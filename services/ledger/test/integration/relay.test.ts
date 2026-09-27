import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool } from '../../src/infrastructure/db';
import { OutboxRelay } from '../../src/relay/outbox-relay';
import { MemoryPublisher } from '../../src/relay/publishers';
import { fixture, Fixture, testPool } from '../support/db';

let pool: Pool;
let f: Fixture;

beforeAll(() => {
  pool = testPool();
  f = fixture(pool);
});

afterAll(() => pool.end());

async function row(id: string) {
  const { rows } = await pool.query('SELECT attempts, published_at, dead_at, last_error, next_attempt_at FROM ledger.outbox WHERE id = $1', [id]);
  return rows[0];
}

async function eventIdsFor(aggregateId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM ledger.outbox WHERE aggregate_id = $1', [aggregateId]);
  return rows.map((r) => r.id);
}

describe('relay del outbox', () => {
  it('publica los eventos pendientes con el sobre del contrato y los marca', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const { value: t } = await f.ledger.transfer({
      userId: ana.owner,
      idempotencyKey: randomUUID(),
      sourceAccountId: ana.account.id,
      destinationClabe: luis.account.clabe,
      amount: 2_500,
      concept: 'Renta',
    });
    const [eventId] = await eventIdsFor(t.id);

    const publisher = new MemoryPublisher();
    await new OutboxRelay(pool, publisher).drain();

    const sent = publisher.published.find((e) => e.id === eventId)!;
    expect(sent).toMatchObject({
      type: 'transfer.posted',
      source: 'ambar.core',
      version: 1,
      aggregate_id: t.id,
      data: { source_account_id: ana.account.id, amount: 2_500, entry_id: t.id, risk: { score: expect.any(Number) } },
    });
    expect((await row(eventId)).published_at).not.toBeNull();

    // Una segunda pasada no vuelve a publicarlo.
    const again = new MemoryPublisher();
    await new OutboxRelay(pool, again).drain();
    expect(again.published.find((e) => e.id === eventId)).toBeUndefined();
  });

  it('una falla programa un reintento con backoff; al vencer, se publica', async () => {
    const { account } = await f.customer();
    const [eventId] = await eventIdsFor(account.id);

    const publisher = new MemoryPublisher();
    publisher.failIds.add(eventId);
    const relay = new OutboxRelay(pool, publisher, { backoffBaseMs: 60_000 });
    await relay.drain();

    const failed = await row(eventId);
    expect(failed).toMatchObject({ attempts: 1, published_at: null, dead_at: null, last_error: 'falla simulada' });
    expect(failed.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 50_000);

    publisher.failIds.clear();
    await relay.drain();
    expect((await row(eventId)).published_at).toBeNull(); // todavía no vence

    await pool.query('UPDATE ledger.outbox SET next_attempt_at = now() WHERE id = $1', [eventId]);
    await relay.drain();
    expect(await row(eventId)).toMatchObject({ attempts: 1, last_error: null });
    expect((await row(eventId)).published_at).not.toBeNull();
  });

  it('tras el máximo de intentos el evento queda muerto y no se vuelve a tomar', async () => {
    const { account } = await f.customer();
    const [eventId] = await eventIdsFor(account.id);
    const publisher = new MemoryPublisher();
    publisher.failIds.add(eventId);
    const relay = new OutboxRelay(pool, publisher, { maxAttempts: 2, backoffBaseMs: 0 });

    await relay.drain();
    await relay.drain();
    const dead = await row(eventId);
    expect(dead.attempts).toBe(2);
    expect(dead.dead_at).not.toBeNull();

    publisher.failIds.clear();
    await relay.drain();
    expect(publisher.published.find((e) => e.id === eventId)).toBeUndefined();
  });

  it('varias réplicas en paralelo publican cada evento exactamente una vez', async () => {
    await new OutboxRelay(pool, new MemoryPublisher()).drain(); // parte de un outbox vacío
    const opened = await Promise.all(Array.from({ length: 60 }, () => f.accounts.open(`relay-${randomUUID()}`)));
    const ids = new Set((await Promise.all(opened.map((a) => eventIdsFor(a.id)))).flat());

    const publishers = [new MemoryPublisher(), new MemoryPublisher(), new MemoryPublisher()];
    await Promise.all(publishers.map((p) => new OutboxRelay(pool, p, { batchSize: 7 }).drain()));

    const all = publishers.flatMap((p) => p.published.map((e) => e.id)).filter((id) => ids.has(id));
    expect(all).toHaveLength(ids.size);
    expect(new Set(all).size).toBe(ids.size);
    expect(publishers.filter((p) => p.published.length > 0).length).toBeGreaterThan(1);
  });

  it('con LISTEN publica en cuanto se confirma la transacción, sin esperar el sondeo', async () => {
    const publisher = new MemoryPublisher();
    const relay = new OutboxRelay(pool, publisher, { pollIntervalMs: 60_000 });
    await relay.start();
    try {
      await new Promise((r) => setTimeout(r, 100)); // primera vuelta
      const { account } = await f.customer();
      const [eventId] = await eventIdsFor(account.id);
      const started = Date.now();
      while (!publisher.published.some((e) => e.id === eventId)) {
        if (Date.now() - started > 3_000) throw new Error('El relay no reaccionó a NOTIFY');
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      await relay.stop();
    }
  });

  it('corre con ambar_relay, que no puede leer saldos, asientos ni avisos', async () => {
    const admin = testPool(1);
    const password = `pw-${randomUUID()}`;
    await admin.query(`ALTER ROLE ambar_relay PASSWORD '${password}'`);
    const url = new URL(process.env.DATABASE_URL_TEST!);
    url.username = 'ambar_relay';
    url.password = password;
    const relayPool = createPool(url.toString(), 2);
    try {
      const { account } = await f.customer();
      const [eventId] = await eventIdsFor(account.id);
      const publisher = new MemoryPublisher();
      await new OutboxRelay(relayPool, publisher).drain();
      expect(publisher.published.some((e) => e.id === eventId)).toBe(true);

      const denied = /permission denied/;
      await expect(relayPool.query('SELECT balance FROM ledger.accounts LIMIT 1')).rejects.toThrow(denied);
      await expect(relayPool.query('SELECT 1 FROM ledger.journal_entries LIMIT 1')).rejects.toThrow(denied);
      await expect(relayPool.query('SELECT 1 FROM customer.notifications LIMIT 1')).rejects.toThrow(denied);
      await expect(relayPool.query(`UPDATE ledger.outbox SET payload = '{}'::jsonb WHERE id = $1`, [eventId])).rejects.toThrow(denied);
      await expect(relayPool.query('DELETE FROM ledger.outbox')).rejects.toThrow(denied);
      await expect(relayPool.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'x', '{}')`, [randomUUID()])).rejects.toThrow(denied);
    } finally {
      await relayPool.end();
      await admin.end();
    }
  });
});
