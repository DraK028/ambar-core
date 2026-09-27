import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DevicesService, MAX_ACTIVE_DEVICES } from '../../src/application/devices.service';
import { LedgerService } from '../../src/application/ledger.service';
import { StepUpService, type StepUpPolicy, type TransferOperation } from '../../src/application/step-up.service';
import { DeviceLimitReachedError, NotFoundError, StepUpRequiredError, ValidationError } from '../../src/domain/errors';
import { FakeDevice } from '../support/device';
import { fixture, type Fixture, testPool } from '../support/db';

const MOBILE = 'ambar-local-mobile';
const WEB = 'ambar-local-web';
const policy: StepUpPolicy = { threshold: 500_000, clientIds: new Set([MOBILE]) };

let pool: Pool;
let f: Fixture;
let devices: DevicesService;
let stepUp: StepUpService;
let ledger: LedgerService;

beforeAll(() => {
  pool = testPool();
  f = fixture(pool);
  devices = new DevicesService(pool);
  stepUp = new StepUpService(pool);
  ledger = new LedgerService(pool, stepUp, policy);
});

afterAll(async () => {
  await pool.end();
});

async function enrolled(balance = 1_000_000) {
  const customer = await f.customer(balance);
  const device = new FakeDevice();
  const view = await devices.register(customer.owner, { publicKey: device.publicKeyBase64, platform: 'android', name: 'Pixel de prueba' });
  return { ...customer, device, deviceId: view.id };
}

function op(from: { account: { id: string } }, clabe: string, amount: number, concept = 'Prueba'): TransferOperation {
  return { type: 'transfer', source_account_id: from.account.id, destination_clabe: clabe, amount, concept };
}

function transfer(
  from: { owner: string; account: { id: string } },
  clabe: string,
  amount: number,
  extra: { clientId?: string; proof?: string; key?: string; concept?: string } = {},
) {
  return ledger.transfer({
    userId: from.owner,
    clientId: extra.clientId ?? MOBILE,
    stepUpProof: extra.proof,
    idempotencyKey: extra.key ?? randomUUID(),
    sourceAccountId: from.account.id,
    destinationClabe: clabe,
    amount,
    concept: extra.concept ?? 'Prueba',
  });
}

async function expectStepUp(promise: Promise<unknown>, reason: StepUpRequiredError['reason']) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StepUpRequiredError);
  expect((err as StepUpRequiredError).reason).toBe(reason);
}

describe('registro de dispositivos', () => {
  it('registra, lista y revoca', async () => {
    const { owner, deviceId } = await enrolled(0);
    expect(await devices.list(owner)).toEqual([expect.objectContaining({ id: deviceId, status: 'ACTIVE', platform: 'android' })]);

    await devices.revoke(owner, deviceId);
    expect((await devices.list(owner))[0]).toMatchObject({ status: 'REVOKED' });
    await expect(devices.revoke(owner, deviceId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('no permite revocar el dispositivo de otra persona', async () => {
    const ana = await enrolled(0);
    const intruso = await f.customer();
    await expect(devices.revoke(intruso.owner, ana.deviceId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('una misma llave no se registra dos veces', async () => {
    const ana = await enrolled(0);
    await expect(
      devices.register(ana.owner, { publicKey: ana.device.publicKeyBase64, platform: 'ios', name: 'Otra vez' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it(`máximo ${MAX_ACTIVE_DEVICES} dispositivos activos, incluso con registros en paralelo`, async () => {
    const { owner } = await f.customer();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        devices.register(owner, { publicKey: new FakeDevice().publicKeyBase64, platform: 'ios', name: `Tel ${i}` }),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(MAX_ACTIVE_DEVICES);
    for (const a of attempts.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(a.reason).toBeInstanceOf(DeviceLimitReachedError);
    }
  });
});

describe('step-up en transferencias', () => {
  it('monto alto: pide confirmación, acepta la firma correcta y mueve el dinero una sola vez', async () => {
    const ana = await enrolled();
    const luis = await f.customer();
    const key = randomUUID();

    await expectStepUp(transfer(ana, luis.account.clabe, 600_000, { key }), 'AMOUNT_THRESHOLD');
    expect(await f.balance(ana.account.id)).toBe(1_000_000);

    const challenge = await stepUp.createChallenge(ana.owner, ana.deviceId, op(ana, luis.account.clabe, 600_000));
    expect(challenge.signing_payload).toMatch(/^ambar-step-up:v1\n/);
    const done = await transfer(ana, luis.account.clabe, 600_000, { key, proof: ana.device.proof(challenge) });

    expect(done.replayed).toBe(false);
    expect(await f.balance(ana.account.id)).toBe(400_000);

    // El reintento de red con la misma Idempotency-Key no vuelve a pedir biometría.
    const again = await transfer(ana, luis.account.clabe, 600_000, { key });
    expect(again.replayed).toBe(true);
    expect(await f.balance(ana.account.id)).toBe(400_000);
  });

  it('beneficiario nuevo: pide confirmación; la segunda vez al mismo destino ya no', async () => {
    const ana = await enrolled();
    const luis = await f.customer();

    await expectStepUp(transfer(ana, luis.account.clabe, 10_000), 'NEW_BENEFICIARY');
    const challenge = await stepUp.createChallenge(ana.owner, ana.deviceId, op(ana, luis.account.clabe, 10_000));
    await transfer(ana, luis.account.clabe, 10_000, { proof: ana.device.proof(challenge) });

    await expect(transfer(ana, luis.account.clabe, 5_000)).resolves.toMatchObject({ replayed: false });
  });

  it('una prueba no se puede reutilizar (replay)', async () => {
    const ana = await enrolled();
    const luis = await f.customer();
    const challenge = await stepUp.createChallenge(ana.owner, ana.deviceId, op(ana, luis.account.clabe, 600_000));
    const proof = ana.device.proof(challenge);

    await transfer(ana, luis.account.clabe, 600_000, { proof });
    await expectStepUp(transfer(ana, luis.account.clabe, 600_000, { proof }), 'INVALID_PROOF');
    expect(await f.balance(ana.account.id)).toBe(400_000);
  });

  it('la misma prueba enviada en paralelo solo pasa una vez', async () => {
    const ana = await enrolled();
    const luis = await f.customer();
    const challenge = await stepUp.createChallenge(ana.owner, ana.deviceId, op(ana, luis.account.clabe, 600_000));
    const proof = ana.device.proof(challenge);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => transfer(ana, luis.account.clabe, 600_000, { proof })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await f.balance(ana.account.id)).toBe(400_000);
  });

  it('una firma para $6,000 no autoriza $9,000 ni otro destino', async () => {
    const ana = await enrolled();
    const luis = await f.customer();
    const mula = await f.customer();
    const challenge = await stepUp.createChallenge(ana.owner, ana.deviceId, op(ana, luis.account.clabe, 600_000));
    const proof = ana.device.proof(challenge);

    await expectStepUp(transfer(ana, luis.account.clabe, 900_000, { proof }), 'INVALID_PROOF');
    await expectStepUp(transfer(ana, mula.account.clabe, 600_000, { proof }), 'INVALID_PROOF');
    await expectStepUp(transfer(ana, luis.account.clabe, 600_000, { proof, concept: 'Otro concepto' }), 'INVALID_PROOF');
    expect(await f.balance(ana.account.id)).toBe(1_000_000);
  });

  it('rechaza firmas de otra llave, retos vencidos y dispositivos revocados', async () => {
    const ana = await enrolled();
    const luis = await f.customer();
    const operation = op(ana, luis.account.clabe, 600_000);

    const c1 = await stepUp.createChallenge(ana.owner, ana.deviceId, operation);
    await expectStepUp(transfer(ana, luis.account.clabe, 600_000, { proof: new FakeDevice().proof(c1) }), 'INVALID_PROOF');

    const c2 = await stepUp.createChallenge(ana.owner, ana.deviceId, operation);
    await pool.query(`UPDATE identity.step_up_challenges SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 second' WHERE id = $1`, [c2.id]);
    await expectStepUp(transfer(ana, luis.account.clabe, 600_000, { proof: ana.device.proof(c2) }), 'INVALID_PROOF');

    const c3 = await stepUp.createChallenge(ana.owner, ana.deviceId, operation);
    await devices.revoke(ana.owner, ana.deviceId);
    await expectStepUp(transfer(ana, luis.account.clabe, 600_000, { proof: ana.device.proof(c3) }), 'INVALID_PROOF');
    await expect(stepUp.createChallenge(ana.owner, ana.deviceId, operation)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('el reto de un usuario no sirve para otro, ni con su propio dispositivo', async () => {
    const ana = await enrolled();
    const beto = await enrolled();
    const luis = await f.customer();

    await expect(stepUp.createChallenge(beto.owner, ana.deviceId, op(beto, luis.account.clabe, 600_000))).rejects.toBeInstanceOf(NotFoundError);
    await expect(stepUp.createChallenge(beto.owner, beto.deviceId, op(ana, luis.account.clabe, 600_000))).rejects.toBeInstanceOf(NotFoundError);

    const anaChallenge = await stepUp.createChallenge(ana.owner, ana.deviceId, op(ana, luis.account.clabe, 600_000));
    await expectStepUp(
      transfer(beto, luis.account.clabe, 600_000, { proof: beto.device.proof(anaChallenge) }),
      'INVALID_PROOF',
    );
  });

  it('la política aplica a la app móvil; la banca web no la usa todavía', async () => {
    const ana = await enrolled();
    const luis = await f.customer();
    await expect(transfer(ana, luis.account.clabe, 600_000, { clientId: WEB })).resolves.toMatchObject({ replayed: false });
  });
});
