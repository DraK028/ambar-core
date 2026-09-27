import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AccountsService } from '../../src/application/accounts.service';
import { DevicesService } from '../../src/application/devices.service';
import { FraudService } from '../../src/application/fraud.service';
import { NotificationsService } from '../../src/application/notifications.service';
import { StepUpService } from '../../src/application/step-up.service';
import { FakeDevice } from '../support/device';
import { LedgerService } from '../../src/application/ledger.service';
import { ReconciliationService } from '../../src/application/reconciliation.service';
import { createPool } from '../../src/infrastructure/db';
import { newOwner, testPool } from '../support/db';

/**
 * El servicio en AWS se conecta como ambar_app (migración 003), que solo hereda app_ledger.
 * Esta prueba corre las operaciones reales con ese usuario para demostrar que los permisos
 * alcanzan, y que los que se quitaron realmente no están.
 */
describe('usuario de aplicación con mínimo privilegio', () => {
  const password = `pw-${randomUUID()}`;
  let admin: Pool;
  let app: Pool;

  beforeAll(async () => {
    admin = testPool(2);
    await admin.query(`ALTER ROLE ambar_app PASSWORD '${password}'`);
    const url = new URL(process.env.DATABASE_URL_TEST!);
    url.username = 'ambar_app';
    url.password = password;
    app = createPool(url.toString(), 5);
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  it('puede abrir cuentas, depositar, transferir, reversar y conciliar', async () => {
    const accounts = new AccountsService(app);
    const ledger = new LedgerService(app);
    const anaOwner = newOwner();
    const ana = await accounts.open(anaOwner);
    const luis = await accounts.open(newOwner());

    await ledger.deposit({ idempotencyKey: randomUUID(), accountId: ana.id, amount: 5_000, concept: 'Fondeo' });
    const { value: t } = await ledger.transfer({
      userId: anaOwner,
      idempotencyKey: randomUUID(),
      sourceAccountId: ana.id,
      destinationClabe: luis.clabe,
      amount: 1_500,
      concept: 'Prueba de permisos',
    });
    await ledger.reverse({ actor: 'ops', idempotencyKey: randomUUID(), entryId: t.id, reason: 'Prueba de permisos' });

    expect((await accounts.getForOwner(ana.id, anaOwner)).balance).toBe(5_000);
    expect((await new ReconciliationService(app).run()).ok).toBe(true);
  });

  it('puede registrar dispositivos y emitir retos, pero no borrarlos', async () => {
    const accounts = new AccountsService(app);
    const owner = newOwner();
    const account = await accounts.open(owner);
    const device = await new DevicesService(app).register(owner, { publicKey: new FakeDevice().publicKeyBase64, platform: 'ios', name: 'Tel' });
    await new StepUpService(app).createChallenge(owner, device.id, {
      type: 'transfer',
      source_account_id: account.id,
      destination_clabe: account.clabe,
      amount: 100,
      concept: 'x',
    });
    await expect(app.query('DELETE FROM identity.step_up_challenges')).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM identity.devices')).rejects.toThrow(/permission denied/);
  });

  it('puede operar avisos y casos de fraude (incluido congelar), pero no borrarlos', async () => {
    const accounts = new AccountsService(app);
    const ledger = new LedgerService(app);
    const anaOwner = newOwner();
    const ana = await accounts.open(anaOwner);
    const luis = await accounts.open(newOwner());
    await ledger.deposit({ idempotencyKey: randomUUID(), accountId: ana.id, amount: 5_000, concept: 'Fondeo' });
    const { value: t } = await ledger.transfer({
      userId: anaOwner,
      idempotencyKey: randomUUID(),
      sourceAccountId: ana.id,
      destinationClabe: luis.clabe,
      amount: 1_000,
      concept: 'x',
    });
    const fraud = new FraudService(app);
    const { fraud_case } = await fraud.open(t.id);
    expect((await fraud.answer(anaOwner, fraud_case.id, false)).account_frozen).toBe(true);
    await new NotificationsService(app).createInternal({ eventId: randomUUID(), kind: 'SECURITY', ownerId: anaOwner, title: 't', body: 'b' });
    expect((await accounts.unfreeze('ops', ana.id, 'Revisado')).status).toBe('ACTIVE');

    await expect(app.query('DELETE FROM customer.notifications')).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM customer.fraud_cases')).rejects.toThrow(/permission denied/);
  });

  it('no tiene permiso de modificar ni borrar el ledger, ni de tocar el esquema', async () => {
    const denied = /permission denied/;
    await expect(app.query('UPDATE ledger.postings SET amount = amount')).rejects.toThrow(denied);
    await expect(app.query('DELETE FROM ledger.journal_entries')).rejects.toThrow(denied);
    await expect(app.query('TRUNCATE ledger.postings')).rejects.toThrow(denied);
    await expect(app.query('DROP TABLE ledger.outbox')).rejects.toThrow(/must be owner|permission denied/);
    await expect(app.query('SELECT * FROM public.schema_migrations')).rejects.toThrow(denied);
  });
});
