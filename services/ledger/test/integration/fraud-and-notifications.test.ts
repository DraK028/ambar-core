import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DevicesService } from '../../src/application/devices.service';
import { FraudService } from '../../src/application/fraud.service';
import { NotificationsService } from '../../src/application/notifications.service';
import { ReconciliationService } from '../../src/application/reconciliation.service';
import { FakeDevice } from '../support/device';
import { fixture, Fixture, testPool } from '../support/db';

let pool: Pool;
let f: Fixture;
let fraud: FraudService;
let notifications: NotificationsService;
let devices: DevicesService;

beforeAll(() => {
  pool = testPool();
  f = fixture(pool);
  fraud = new FraudService(pool);
  notifications = new NotificationsService(pool);
  devices = new DevicesService(pool);
});

afterAll(() => pool.end());

async function transfer(owner: string, sourceId: string, clabe: string, amount: number) {
  const { value } = await f.ledger.transfer({
    userId: owner,
    idempotencyKey: randomUUID(),
    sourceAccountId: sourceId,
    destinationClabe: clabe,
    amount,
    concept: 'Prueba',
  });
  return value;
}

async function outboxEvent(entryId: string) {
  const { rows } = await pool.query<{ event_type: string; payload: any }>(
    'SELECT event_type, payload FROM ledger.outbox WHERE aggregate_id = $1',
    [entryId],
  );
  return rows[0];
}

describe('riesgo en transfer.posted', () => {
  it('la primera transferencia a un beneficiario nuevo lleva NEW_BENEFICIARY; la segunda no', async () => {
    const ana = await f.customer(1_000_000);
    const luis = await f.customer();

    const first = await transfer(ana.owner, ana.account.id, luis.account.clabe, 10_000);
    const e1 = await outboxEvent(first.id);
    expect(e1.event_type).toBe('transfer.posted');
    expect(e1.payload.risk.reasons).toContain('NEW_BENEFICIARY');
    expect(e1.payload.risk.score).toBeGreaterThanOrEqual(35);

    const second = await transfer(ana.owner, ana.account.id, luis.account.clabe, 10_000);
    expect((await outboxEvent(second.id)).payload.risk.reasons).not.toContain('NEW_BENEFICIARY');
  });

  it('un monto mucho mayor al promedio suma UNUSUAL_AMOUNT', async () => {
    const ana = await f.customer(2_000_000);
    const luis = await f.customer();
    await transfer(ana.owner, ana.account.id, luis.account.clabe, 10_000);
    const big = await transfer(ana.owner, ana.account.id, luis.account.clabe, 50_000);
    expect((await outboxEvent(big.id)).payload.risk.reasons).toEqual(expect.arrayContaining(['UNUSUAL_AMOUNT']));
  });

  it('la cuarta transferencia en 10 minutos suma HIGH_VELOCITY', async () => {
    const ana = await f.customer(1_000_000);
    const luis = await f.customer();
    for (let i = 0; i < 3; i++) await transfer(ana.owner, ana.account.id, luis.account.clabe, 1_000);
    const fourth = await transfer(ana.owner, ana.account.id, luis.account.clabe, 1_000);
    expect((await outboxEvent(fourth.id)).payload.risk.reasons).toContain('HIGH_VELOCITY');
  });
});

describe('avisos', () => {
  it('un aviso se crea una vez por evento aunque n8n reintente', async () => {
    const ana = await f.customer();
    const eventId = randomUUID();
    const input = { eventId, kind: 'WELCOME' as const, accountId: ana.account.id, title: 'Bienvenida', body: 'Tu cuenta está lista.' };

    const first = await notifications.createInternal(input);
    const retry = await notifications.createInternal({ ...input, title: 'Otro título' });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.notification.id).toBe(first.notification.id);
    expect(retry.notification.title).toBe('Bienvenida');

    const inbox = await notifications.inbox(ana.owner);
    expect(inbox.data).toHaveLength(1);
    expect(inbox.unread_count).toBe(1);
  });

  it('marcar como leído es idempotente y solo funciona con avisos propios', async () => {
    const ana = await f.customer();
    const luis = await f.customer();
    const { notification } = await notifications.createInternal({
      eventId: randomUUID(),
      kind: 'SECURITY',
      ownerId: ana.owner,
      title: 'Nuevo dispositivo',
      body: 'Se activó un teléfono.',
    });
    await expect(notifications.markRead(luis.owner, notification.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await notifications.markRead(ana.owner, notification.id);
    const readAt = (await notifications.inbox(ana.owner)).data[0].read_at;
    await notifications.markRead(ana.owner, notification.id);
    expect((await notifications.inbox(ana.owner)).data[0].read_at).toBe(readAt);
    expect((await notifications.inbox(ana.owner)).unread_count).toBe(0);
  });

  it('una cuenta inexistente o de sistema no recibe avisos', async () => {
    await expect(
      notifications.createInternal({ eventId: randomUUID(), kind: 'WELCOME', accountId: randomUUID(), title: 'x', body: 'y' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('devuelve los tokens push solo de dispositivos activos', async () => {
    const ana = await f.customer();
    const phone = await devices.register(ana.owner, { publicKey: new FakeDevice().publicKeyBase64, platform: 'android', name: 'Pixel' });
    const old = await devices.register(ana.owner, { publicKey: new FakeDevice().publicKeyBase64, platform: 'ios', name: 'iPhone' });
    await devices.setPushToken(ana.owner, phone.id, 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]');
    await devices.setPushToken(ana.owner, old.id, 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]');
    await devices.revoke(ana.owner, old.id);

    const { push_tokens } = await notifications.createInternal({
      eventId: randomUUID(),
      kind: 'SECURITY',
      ownerId: ana.owner,
      title: 't',
      body: 'b',
    });
    expect(push_tokens).toEqual(['ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]']);
    await expect(devices.setPushToken(ana.owner, old.id, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('casos de fraude', () => {
  async function risky() {
    const ana = await f.customer(3_000_000);
    const luis = await f.customer();
    const t = await transfer(ana.owner, ana.account.id, luis.account.clabe, 1_500_000);
    return { ana, luis, t };
  }

  it('abre el caso con los datos del asiento y un aviso FRAUD_CHECK, una sola vez', async () => {
    const { ana, luis, t } = await risky();
    const opened = await fraud.open(t.id);
    expect(opened.created).toBe(true);
    expect(opened.fraud_case).toMatchObject({
      status: 'OPEN',
      account_id: ana.account.id,
      transfer: { entry_id: t.id, amount: 1_500_000, destination_clabe_last4: luis.account.clabe.slice(-4) },
    });
    expect(opened.fraud_case.score).toBeGreaterThanOrEqual(60);
    expect(opened.notification).toMatchObject({ kind: 'FRAUD_CHECK', data: { fraud_case_id: opened.fraud_case.id } });
    expect(opened.notification.body).toContain('$15,000.00');

    const again = await fraud.open(t.id);
    expect(again.created).toBe(false);
    expect(again.fraud_case.id).toBe(opened.fraud_case.id);
    expect((await notifications.inbox(ana.owner)).data.filter((n) => n.kind === 'FRAUD_CHECK')).toHaveLength(1);
  });

  it('no abre casos sobre depósitos ni asientos inexistentes', async () => {
    const ana = await f.customer();
    const dep = await f.ledger.deposit({ idempotencyKey: randomUUID(), accountId: ana.account.id, amount: 100, concept: 'x' });
    await expect(fraud.open(dep.value.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(fraud.open(randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('el cliente ve su caso (sin puntaje); otro usuario recibe 404', async () => {
    const { ana, luis, t } = await risky();
    const { fraud_case } = await fraud.open(t.id);
    const view = await fraud.getForOwner(ana.owner, fraud_case.id);
    expect(view).not.toHaveProperty('score');
    await expect(fraud.getForOwner(luis.owner, fraud_case.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('"sí fui yo" cierra el caso sin congelar la cuenta', async () => {
    const { ana, t } = await risky();
    const { fraud_case } = await fraud.open(t.id);
    const res = await fraud.answer(ana.owner, fraud_case.id, true);
    expect(res).toMatchObject({ status: 'RECOGNIZED', account_frozen: false });
    expect((await f.accounts.getForOwner(ana.account.id, ana.owner)).status).toBe('ACTIVE');
  });

  it('"no la reconozco" congela la cuenta en la misma transacción y emite los eventos', async () => {
    const { ana, luis, t } = await risky();
    const { fraud_case } = await fraud.open(t.id);
    const res = await fraud.answer(ana.owner, fraud_case.id, false);
    expect(res).toMatchObject({ status: 'NOT_RECOGNIZED', account_frozen: true });

    // Congelada: puede recibir, no enviar.
    await expect(transfer(ana.owner, ana.account.id, luis.account.clabe, 100)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
    await transfer(luis.owner, luis.account.id, ana.account.clabe, 100);

    const { rows } = await pool.query<{ event_type: string; payload: any }>(
      `SELECT event_type, payload FROM ledger.outbox WHERE aggregate_id IN ($1, $2) ORDER BY created_at`,
      [ana.account.id, fraud_case.id],
    );
    const types = rows.map((r) => r.event_type);
    expect(types).toEqual(expect.arrayContaining(['account.frozen', 'fraud_case.answered']));
    expect(rows.find((r) => r.event_type === 'fraud_case.answered')!.payload).toMatchObject({ recognized: false, account_frozen: true });

    // Repetir la misma respuesta es idempotente; cambiarla no se permite.
    expect(await fraud.answer(ana.owner, fraud_case.id, false)).toMatchObject({ status: 'NOT_RECOGNIZED', account_frozen: true });
    await expect(fraud.answer(ana.owner, fraud_case.id, true)).rejects.toMatchObject({ code: 'FRAUD_CASE_CLOSED' });

    // Operación la descongela (idempotente) y queda auditado.
    expect((await f.accounts.unfreeze('ops-1', ana.account.id, 'Cliente verificado por teléfono')).status).toBe('ACTIVE');
    expect((await f.accounts.unfreeze('ops-1', ana.account.id, 'Otra vez')).status).toBe('ACTIVE');
    const unfrozen = await pool.query(`SELECT 1 FROM ledger.outbox WHERE aggregate_id = $1 AND event_type = 'account.unfrozen'`, [ana.account.id]);
    expect(unfrozen.rowCount).toBe(1);
  });

  it('dos respuestas simultáneas distintas: gana una, la otra recibe 409', async () => {
    const { ana, t } = await risky();
    const { fraud_case } = await fraud.open(t.id);
    const results = await Promise.allSettled([
      fraud.answer(ana.owner, fraud_case.id, true),
      fraud.answer(ana.owner, fraud_case.id, false),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'FRAUD_CASE_CLOSED' } });
    const answered = await pool.query(`SELECT 1 FROM ledger.outbox WHERE aggregate_id = $1 AND event_type = 'fraud_case.answered'`, [fraud_case.id]);
    expect(answered.rowCount).toBe(1);
  });
});

describe('salud del outbox', () => {
  it('reporta pendientes y muertos', async () => {
    const report = await new ReconciliationService(pool).fullReport();
    expect(report.outbox.pending).toBeGreaterThan(0); // en pruebas nadie publica
    expect(report.ledger.ok).toBe(true);
    expect(report).toHaveProperty('ok');
  });
});
