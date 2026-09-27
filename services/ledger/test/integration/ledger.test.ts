import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ReconciliationService } from '../../src/application/reconciliation.service';
import {
  AccountNotActiveError,
  AlreadyReversedError,
  IdempotencyKeyReusedError,
  InsufficientFundsError,
  NotFoundError,
  NotReversibleError,
  SameAccountError,
} from '../../src/domain/errors';
import { Fixture, fixture, testPool } from '../support/db';

let pool: Pool;
let f: Fixture;

beforeAll(() => {
  pool = testPool();
  f = fixture(pool);
});

afterAll(async () => {
  await pool.end();
});

async function transfer(from: { owner: string; account: { id: string } }, toClabe: string, amount: number, key = randomUUID()) {
  return f.ledger.transfer({
    userId: from.owner,
    idempotencyKey: key,
    sourceAccountId: from.account.id,
    destinationClabe: toClabe,
    amount,
    concept: 'Prueba',
  });
}

describe('transferencias', () => {
  it('mueve el saldo, registra un asiento cuadrado y escribe el evento en el outbox', async () => {
    const ana = await f.customer(100_000);
    const luis = await f.customer();

    const { value, replayed } = await transfer(ana, luis.account.clabe, 45_000);

    expect(replayed).toBe(false);
    expect(value).toMatchObject({
      status: 'POSTED',
      source_account_id: ana.account.id,
      destination_account_id: luis.account.id,
      amount: 45_000,
      currency: 'MXN',
    });
    expect(await f.balance(ana.account.id)).toBe(55_000);
    expect(await f.balance(luis.account.id)).toBe(45_000);

    const { rows: postings } = await pool.query('SELECT account_id, amount FROM ledger.postings WHERE entry_id = $1 ORDER BY id', [value.id]);
    expect(postings).toEqual([
      { account_id: ana.account.id, amount: 45_000 },
      { account_id: luis.account.id, amount: -45_000 },
    ]);

    const { rows: events } = await pool.query('SELECT event_type, payload FROM ledger.outbox WHERE aggregate_id = $1', [value.id]);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('transfer.posted');
    expect(events[0].payload).toMatchObject({ entry_id: value.id, amount: 45_000 });
  });

  it('rechaza la operación si no hay fondos y no deja rastro', async () => {
    const ana = await f.customer(1_000);
    const luis = await f.customer();
    const key = randomUUID();

    await expect(transfer(ana, luis.account.clabe, 1_001, key)).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(await f.balance(ana.account.id)).toBe(1_000);
    const { rowCount } = await pool.query('SELECT 1 FROM ledger.journal_entries WHERE idempotency_key LIKE $1', [`%${key}`]);
    expect(rowCount).toBe(0);
  });

  it('no permite usar la cuenta de otro usuario como origen (BOLA)', async () => {
    const ana = await f.customer(10_000);
    const intruso = await f.customer();
    await expect(
      f.ledger.transfer({
        userId: intruso.owner,
        idempotencyKey: randomUUID(),
        sourceAccountId: ana.account.id,
        destinationClabe: intruso.account.clabe,
        amount: 100,
        concept: 'Robo',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await f.balance(ana.account.id)).toBe(10_000);
  });

  it('rechaza CLABE inexistente y transferencias a la misma cuenta', async () => {
    const ana = await f.customer(10_000);
    await expect(transfer(ana, '999180999999999990', 100)).rejects.toBeInstanceOf(NotFoundError);
    await expect(transfer(ana, ana.account.clabe, 100)).rejects.toBeInstanceOf(SameAccountError);
  });

  it('una cuenta congelada no puede enviar, pero sí recibir', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer(10_000);
    await pool.query(`UPDATE ledger.accounts SET status = 'FROZEN' WHERE id = $1`, [ana.account.id]);

    await expect(transfer(ana, luis.account.clabe, 100)).rejects.toBeInstanceOf(AccountNotActiveError);
    await transfer(luis, ana.account.clabe, 100);
    expect(await f.balance(ana.account.id)).toBe(10_100);
  });
});

describe('idempotencia', () => {
  it('repetir la misma llave con el mismo cuerpo devuelve el asiento original', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const key = randomUUID();

    const first = await transfer(ana, luis.account.clabe, 2_500, key);
    const second = await transfer(ana, luis.account.clabe, 2_500, key);

    expect(second.replayed).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(await f.balance(ana.account.id)).toBe(7_500);
  });

  it('reusar la llave con otro cuerpo es un error', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const key = randomUUID();

    await transfer(ana, luis.account.clabe, 2_500, key);
    await expect(transfer(ana, luis.account.clabe, 2_600, key)).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    expect(await f.balance(ana.account.id)).toBe(7_500);
  });

  it('diez reintentos simultáneos con la misma llave cobran una sola vez', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 10 }, () => transfer(ana, luis.account.clabe, 1_000, key)));

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.value.id)).size).toBe(1);
    expect(await f.balance(ana.account.id)).toBe(9_000);
    expect(await f.balance(luis.account.id)).toBe(1_000);
  });

  it('la llave está aislada por usuario', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer(10_000);
    const key = randomUUID();

    const a = await transfer(ana, luis.account.clabe, 100, key);
    const b = await transfer(luis, ana.account.clabe, 100, key);
    expect(a.value.id).not.toBe(b.value.id);
    expect(b.replayed).toBe(false);
  });
});

describe('concurrencia', () => {
  it('50 transferencias simultáneas contra un saldo que alcanza para 10: nunca hay sobregiro', async () => {
    const ana = await f.customer(1_000);
    const luis = await f.customer();

    const results = await Promise.allSettled(Array.from({ length: 50 }, () => transfer(ana, luis.account.clabe, 100)));

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(40);
    for (const r of failed) expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    expect(await f.balance(ana.account.id)).toBe(0);
    expect(await f.balance(luis.account.id)).toBe(1_000);
  });

  it('transferencias cruzadas A→B y B→A al mismo tiempo no generan deadlock', async () => {
    const a = await f.customer(5_000);
    const b = await f.customer(5_000);

    const ops = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? transfer(a, b.account.clabe, 100) : transfer(b, a.account.clabe, 100),
    );
    const results = await Promise.allSettled(ops);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await f.balance(a.account.id)).toBe(5_000);
    expect(await f.balance(b.account.id)).toBe(5_000);
  });
});

describe('reversos', () => {
  it('un reverso restaura saldos sin modificar el asiento original', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const { value: t } = await transfer(ana, luis.account.clabe, 3_000);

    const { value: reversal } = await f.ledger.reverse({
      actor: 'ops-1',
      idempotencyKey: randomUUID(),
      entryId: t.id,
      reason: 'Cargo no reconocido',
    });

    expect(reversal.kind).toBe('REVERSAL');
    expect(reversal.reverses_id).toBe(t.id);
    expect(reversal.postings).toEqual([
      { account_id: ana.account.id, amount: -3_000 },
      { account_id: luis.account.id, amount: 3_000 },
    ]);
    expect(await f.balance(ana.account.id)).toBe(10_000);
    expect(await f.balance(luis.account.id)).toBe(0);
    const original = await f.ledger.getEntry(t.id);
    expect(original.kind).toBe('TRANSFER');
  });

  it('un asiento solo se reversa una vez y un reverso no se reversa', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const { value: t } = await transfer(ana, luis.account.clabe, 1_000);
    const key = randomUUID();
    const reverse = (k: string, entryId = t.id) => f.ledger.reverse({ actor: 'ops-1', idempotencyKey: k, entryId, reason: 'Error operativo' });

    const first = await reverse(key);
    expect((await reverse(key)).replayed).toBe(true);
    await expect(reverse(randomUUID())).rejects.toBeInstanceOf(AlreadyReversedError);
    await expect(reverse(randomUUID(), first.value.id)).rejects.toBeInstanceOf(NotReversibleError);
  });

  it('un reverso puede sacar dinero de una cuenta congelada (fraude)', async () => {
    const victima = await f.customer(10_000);
    const mula = await f.customer();
    const { value: t } = await transfer(victima, mula.account.clabe, 4_000);
    await pool.query(`UPDATE ledger.accounts SET status = 'FROZEN' WHERE id = $1`, [mula.account.id]);

    await f.ledger.reverse({ actor: 'fraude', idempotencyKey: randomUUID(), entryId: t.id, reason: 'Fraude confirmado' });

    expect(await f.balance(victima.account.id)).toBe(10_000);
    expect(await f.balance(mula.account.id)).toBe(0);
  });

  it('el reverso falla si el destino ya gastó el dinero', async () => {
    const ana = await f.customer(10_000);
    const luis = await f.customer();
    const tercero = await f.customer();
    const { value: t } = await transfer(ana, luis.account.clabe, 1_000);
    await transfer(luis, tercero.account.clabe, 1_000);

    await expect(
      f.ledger.reverse({ actor: 'ops', idempotencyKey: randomUUID(), entryId: t.id, reason: 'Error operativo' }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });
});

describe('invariantes en la base de datos', () => {
  async function inTx(fn: (q: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn((sql, params) => client.query(sql, params));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  it('un asiento descuadrado insertado a mano se rechaza al hacer COMMIT', async () => {
    const ana = await f.customer();
    const luis = await f.customer();
    await expect(
      inTx(async (q) => {
        const entryId = randomUUID();
        await q(`INSERT INTO ledger.journal_entries (id, idempotency_key, request_hash, kind, description) VALUES ($1, $2, 'x', 'TRANSFER', 'manual')`, [
          entryId,
          `manual:${entryId}`,
        ]);
        await q('INSERT INTO ledger.postings (entry_id, account_id, amount) VALUES ($1, $2, 100), ($1, $3, -99)', [
          entryId,
          ana.account.id,
          luis.account.id,
        ]);
      }),
    ).rejects.toThrow(/descuadrado/);
  });

  it('un asiento sin postings se rechaza al hacer COMMIT', async () => {
    await expect(
      inTx(async (q) => {
        await q(`INSERT INTO ledger.journal_entries (idempotency_key, request_hash, kind, description) VALUES ($1, 'x', 'DEPOSIT', 'vacío')`, [
          `manual:${randomUUID()}`,
        ]);
      }),
    ).rejects.toThrow(/descuadrado/);
  });

  it('postings y asientos no se pueden modificar ni borrar', async () => {
    const ana = await f.customer(5_000);
    const { rows } = await pool.query<{ id: number; entry_id: string }>('SELECT id, entry_id FROM ledger.postings WHERE account_id = $1', [
      ana.account.id,
    ]);
    await expect(pool.query('UPDATE ledger.postings SET amount = 1 WHERE id = $1', [rows[0].id])).rejects.toThrow(/solo inserción/);
    await expect(pool.query('DELETE FROM ledger.postings WHERE id = $1', [rows[0].id])).rejects.toThrow(/solo inserción/);
    await expect(pool.query(`UPDATE ledger.journal_entries SET description = 'x' WHERE id = $1`, [rows[0].entry_id])).rejects.toThrow(
      /solo inserción/,
    );
  });

  it('el saldo de una cuenta de cliente no puede ser negativo ni por SQL directo', async () => {
    const ana = await f.customer();
    await expect(pool.query('UPDATE ledger.accounts SET balance = -1 WHERE id = $1', [ana.account.id])).rejects.toThrow(
      /accounts_balance_non_negative/,
    );
  });
});

describe('movimientos', () => {
  it('pagina del más reciente al más antiguo con montos desde la perspectiva del cliente', async () => {
    const ana = await f.customer();
    const luis = await f.customer();
    for (const amount of [100, 200, 300, 400]) {
      await f.ledger.deposit({ idempotencyKey: randomUUID(), accountId: ana.account.id, amount, concept: `Depósito ${amount}` });
    }
    await transfer(ana, luis.account.clabe, 250);

    const p1 = await f.accounts.movements(ana.account.id, ana.owner, 2);
    expect(p1.data.map((m) => m.amount)).toEqual([-250, 400]);
    expect(p1.next_cursor).not.toBeNull();

    const p2 = await f.accounts.movements(ana.account.id, ana.owner, 2, p1.next_cursor!);
    expect(p2.data.map((m) => m.amount)).toEqual([300, 200]);

    const p3 = await f.accounts.movements(ana.account.id, ana.owner, 2, p2.next_cursor!);
    expect(p3.data.map((m) => m.amount)).toEqual([100]);
    expect(p3.next_cursor).toBeNull();
  });

  it('no muestra movimientos de cuentas ajenas', async () => {
    const ana = await f.customer(100);
    const intruso = await f.customer();
    await expect(f.accounts.movements(ana.account.id, intruso.owner)).rejects.toBeInstanceOf(NotFoundError);
    await expect(f.accounts.getForOwner(ana.account.id, intruso.owner)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('conciliación', () => {
  it('tras todas las operaciones anteriores el ledger cuadra', async () => {
    const report = await new ReconciliationService(pool).run();
    expect(report.drift).toEqual([]);
    expect(report.ledger_total).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('detecta un saldo alterado por fuera del ledger', async () => {
    const ana = await f.customer(1_000);
    await pool.query('UPDATE ledger.accounts SET balance = balance + 1 WHERE id = $1', [ana.account.id]);
    try {
      const report = await new ReconciliationService(pool).run();
      expect(report.ok).toBe(false);
      expect(report.drift).toContainEqual(
        expect.objectContaining({ id: ana.account.id, stored_balance: 1_001, derived_balance: 1_000 }),
      );
    } finally {
      await pool.query('UPDATE ledger.accounts SET balance = balance - 1 WHERE id = $1', [ana.account.id]);
    }
  });
});
