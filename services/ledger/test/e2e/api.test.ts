import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import type { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../../src/config';
import { createApp } from '../../src/main';
import { mintDevToken } from '../../src/scripts/mint-dev-token';
import { expectContract } from '../support/contract';
import { FakeDevice } from '../support/device';
import { newOwner, testPool } from '../support/db';

const SECRET = 'e2e-secret-que-tiene-al-menos-32-caracteres';

let pool: Pool;
let app: INestApplication;
let http: ReturnType<typeof request>;

function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    AUTH_MODE: 'local',
    LOCAL_JWT_SECRET: SECRET,
    ENABLE_QA_ENDPOINTS: 'true',
    ...overrides,
  });
}

const token = (sub: string, scopes = 'accounts.read accounts.write transfers.write qa.write') => mintDevToken(sub, scopes, SECRET);

beforeAll(async () => {
  pool = testPool(10);
  app = await createApp(config(), pool, false);
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/** Cliente con su token, una cuenta abierta y (opcionalmente) saldo inicial vía el endpoint de QA. */
async function customer(initial = 0) {
  const sub = newOwner('e2e');
  const bearer = `Bearer ${await token(sub)}`;
  const opened = await http.post('/v1/accounts').set('Authorization', bearer);
  expectContract(opened, 'openAccount');
  if (initial > 0) {
    const dep = await http
      .post('/v1/qa/deposits')
      .set('Authorization', bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ account_id: opened.body.id, amount: initial, concept: 'Nómina' });
    expectContract(dep, 'simulateDeposit');
  }
  return { sub, bearer, account: opened.body as { id: string; clabe: string } };
}

describe('sistema', () => {
  it('GET /health responde sin token', async () => {
    const res = await http.get('/health');
    expect(res.status).toBe(200);
    expectContract(res, 'getHealth');
  });

  it('una ruta inexistente responde 404 como problem+json', async () => {
    const res = await http.get('/v1/nada').set('Authorization', `Bearer ${await token('x')}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('agrega encabezados de seguridad y no expone el framework', async () => {
    const res = await http.get('/health');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('autenticación y autorización', () => {
  it('sin token responde 401', async () => {
    const res = await http.get('/v1/accounts');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expectContract(res, 'listAccounts');
  });

  it('un token expirado responde 401', async () => {
    const expired = await new SignJWT({ scope: 'ambar-api/accounts.read', token_use: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x')
      .setIssuer('ambar-local')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    const res = await http.get('/v1/accounts').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.detail).toMatch(/expiró/);
  });

  it('un token firmado con otro secreto responde 401', async () => {
    const forged = await mintDevToken('x', 'accounts.read', 'otro-secreto-de-al-menos-treinta-y-dos-chars');
    const res = await http.get('/v1/accounts').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('un ID token no sirve como access token', async () => {
    const idToken = await new SignJWT({ token_use: 'id', scope: 'ambar-api/accounts.read' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x')
      .setIssuer('ambar-local')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    const res = await http.get('/v1/accounts').set('Authorization', `Bearer ${idToken}`);
    expect(res.status).toBe(401);
  });

  it('sin el scope requerido responde 403', async () => {
    const readOnly = await token('solo-lectura', 'accounts.read');
    const res = await http
      .post('/v1/transfers')
      .set('Authorization', `Bearer ${readOnly}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expectContract(res, 'createTransfer');
  });
});

describe('cuentas', () => {
  it('abre y lista cuentas del usuario', async () => {
    const ana = await customer();
    const res = await http.get('/v1/accounts').set('Authorization', ana.bearer);
    expectContract(res, 'listAccounts');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: ana.account.id, balance: 0, status: 'ACTIVE', currency: 'MXN' });
  });

  it('la cuenta de otro usuario responde 404 (BOLA)', async () => {
    const ana = await customer(1_000);
    const intruso = await customer();
    const res = await http.get(`/v1/accounts/${ana.account.id}`).set('Authorization', intruso.bearer);
    expect(res.status).toBe(404);
    expectContract(res, 'getAccount');

    const mov = await http.get(`/v1/accounts/${ana.account.id}/movements`).set('Authorization', intruso.bearer);
    expect(mov.status).toBe(404);
    expectContract(mov, 'listMovements');
  });

  it('un id mal formado responde 400', async () => {
    const ana = await customer();
    const res = await http.get('/v1/accounts/no-es-uuid').set('Authorization', ana.bearer);
    expect(res.status).toBe(400);
    expectContract(res, 'getAccount');
  });
});

describe('transferencias', () => {
  it('flujo completo: transferir, repetir, reusar llave y consultar movimientos', async () => {
    const ana = await customer(100_000);
    const luis = await customer();
    const key = randomUUID();
    const body = { source_account_id: ana.account.id, destination_clabe: luis.account.clabe, amount: 45_000, concept: 'Renta' };

    const first = await http.post('/v1/transfers').set('Authorization', ana.bearer).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBe('false');
    expectContract(first, 'createTransfer');

    const again = await http.post('/v1/transfers').set('Authorization', ana.bearer).set('Idempotency-Key', key).send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);

    const reused = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', key)
      .send({ ...body, amount: 1 });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expectContract(reused, 'createTransfer');

    const acc = await http.get(`/v1/accounts/${ana.account.id}`).set('Authorization', ana.bearer);
    expectContract(acc, 'getAccount');
    expect(acc.body.balance).toBe(55_000);

    const mov = await http.get(`/v1/accounts/${ana.account.id}/movements?limit=10`).set('Authorization', ana.bearer);
    expectContract(mov, 'listMovements');
    expect(mov.body.data.map((m: { amount: number }) => m.amount)).toEqual([-45_000, 100_000]);
  });

  it('exige Idempotency-Key', async () => {
    const ana = await customer(1_000);
    const res = await http.post('/v1/transfers').set('Authorization', ana.bearer).send({});
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('Idempotency-Key');
    expectContract(res, 'createTransfer');
  });

  it('valida el cuerpo contra el contrato: decimales y campos extra se rechazan', async () => {
    const ana = await customer(1_000);
    const res = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ source_account_id: ana.account.id, destination_clabe: '123', amount: 10.5, concept: 'x', role: 'admin' });
    expect(res.status).toBe(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['destination_clabe', 'amount']));
    expect(JSON.stringify(res.body.errors)).toMatch(/role/);
    expectContract(res, 'createTransfer');
  });

  it('sin fondos responde 422 INSUFFICIENT_FUNDS', async () => {
    const ana = await customer(1_000);
    const luis = await customer();
    const res = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ source_account_id: ana.account.id, destination_clabe: luis.account.clabe, amount: 5_000, concept: 'Sin saldo' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expectContract(res, 'createTransfer');
  });

  it('no permite transferir desde la cuenta de otro usuario', async () => {
    const ana = await customer(10_000);
    const intruso = await customer();
    const res = await http
      .post('/v1/transfers')
      .set('Authorization', intruso.bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ source_account_id: ana.account.id, destination_clabe: intruso.account.clabe, amount: 100, concept: 'Intento' });
    expect(res.status).toBe(404);
    expectContract(res, 'createTransfer');
  });

  it('rechaza cuerpos mayores a 16 KB', async () => {
    const ana = await customer();
    const res = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ concept: 'x'.repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('JSON mal formado responde 400 VALIDATION_ERROR', async () => {
    const ana = await customer();
    const res = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"amount": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expectContract(res, 'createTransfer');
  });
});

describe('operación del ledger', () => {
  it('un operador consulta y reversa un asiento; el segundo reverso se rechaza', async () => {
    const ana = await customer(10_000);
    const luis = await customer();
    const t = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ source_account_id: ana.account.id, destination_clabe: luis.account.clabe, amount: 2_000, concept: 'Error' });

    const ops = `Bearer ${await mintDevToken('ops-carlos', 'ledger.admin', SECRET, '5m', ['operators'])}`;

    const noScope = await http.get(`/v1/entries/${t.body.id}`).set('Authorization', ana.bearer);
    expect(noScope.status).toBe(403);

    // El scope solo no basta: en Cognito lo recibe cualquiera que use el cliente de operación.
    const scopeWithoutGroup = await http
      .get(`/v1/entries/${t.body.id}`)
      .set('Authorization', `Bearer ${await token('cliente-curioso', 'ledger.admin')}`);
    expect(scopeWithoutGroup.status).toBe(403);
    expect(scopeWithoutGroup.body.detail).toMatch(/operators/);
    expectContract(scopeWithoutGroup, 'getEntry');

    const entry = await http.get(`/v1/entries/${t.body.id}`).set('Authorization', ops);
    expectContract(entry, 'getEntry');
    expect(entry.body.postings).toHaveLength(2);

    const rev = await http
      .post(`/v1/entries/${t.body.id}/reversals`)
      .set('Authorization', ops)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Transferencia duplicada' });
    expect(rev.status).toBe(201);
    expectContract(rev, 'reverseEntry');
    expect(rev.body.reverses_id).toBe(t.body.id);

    const twice = await http
      .post(`/v1/entries/${t.body.id}/reversals`)
      .set('Authorization', ops)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Otra vez' });
    expect(twice.status).toBe(422);
    expect(twice.body.code).toBe('ALREADY_REVERSED');
    expectContract(twice, 'reverseEntry');

    const missing = await http.get(`/v1/entries/${randomUUID()}`).set('Authorization', ops);
    expect(missing.status).toBe(404);
    expectContract(missing, 'getEntry');
  });
});

describe('endpoints de QA', () => {
  it('no existen cuando ENABLE_QA_ENDPOINTS=false', async () => {
    const prodLike = await createApp(config({ ENABLE_QA_ENDPOINTS: 'false' }), pool, false);
    await prodLike.init();
    try {
      const res = await request(prodLike.getHttpServer())
        .post('/v1/qa/deposits')
        .set('Authorization', `Bearer ${await token('x')}`)
        .set('Idempotency-Key', randomUUID())
        .send({ account_id: randomUUID(), amount: 100, concept: 'x' });
      expect(res.status).toBe(404);
    } finally {
      await prodLike.close();
    }
  });
});

describe('app móvil: dispositivos y step-up (RFC 9470)', () => {
  async function mobileToken(sub: string) {
    return new SignJWT({
      scope: ['accounts.read', 'accounts.write', 'transfers.write', 'devices.write'].map((s) => `ambar-api/${s}`).join(' '),
      token_use: 'access',
      client_id: 'ambar-local-mobile',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('ambar-local')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
  }

  it('flujo completo por HTTP: registrar, 401 con step-up, reto, firma y transferencia', async () => {
    const ana = await customer(1_000_000);
    const luis = await customer();
    const bearer = `Bearer ${await mobileToken(ana.sub)}`;
    const device = new FakeDevice();

    const reg = await http
      .post('/v1/devices')
      .set('Authorization', bearer)
      .send({ public_key: device.publicKeyBase64, platform: 'ios', name: 'iPhone de Ana' });
    expect(reg.status).toBe(201);
    expectContract(reg, 'registerDevice');

    const list = await http.get('/v1/devices').set('Authorization', bearer);
    expectContract(list, 'listDevices');
    expect(JSON.stringify(list.body)).not.toContain(device.publicKeyBase64.slice(0, 40)); // nunca devuelve la llave

    const key = randomUUID();
    const body = { source_account_id: ana.account.id, destination_clabe: luis.account.clabe, amount: 750_000, concept: 'Enganche' };

    const needs = await http.post('/v1/transfers').set('Authorization', bearer).set('Idempotency-Key', key).send(body);
    expect(needs.status).toBe(401);
    expect(needs.headers['www-authenticate']).toContain('insufficient_user_authentication');
    expect(needs.body).toMatchObject({ code: 'STEP_UP_REQUIRED', step_up: { reason: 'AMOUNT_THRESHOLD', threshold: 500_000 } });
    expectContract(needs, 'createTransfer');

    const challenge = await http
      .post('/v1/step-up/challenges')
      .set('Authorization', bearer)
      .send({ device_id: reg.body.id, operation: { type: 'transfer', ...body } });
    expect(challenge.status).toBe(201);
    expectContract(challenge, 'createStepUpChallenge');

    const ok = await http
      .post('/v1/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', key)
      .set('X-Step-Up', device.proof(challenge.body))
      .send(body);
    expect(ok.status).toBe(201);
    expectContract(ok, 'createTransfer');

    const bad = await http
      .post('/v1/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', randomUUID())
      .set('X-Step-Up', device.proof(challenge.body))
      .send(body);
    expect(bad.status).toBe(401);
    expect(bad.body.step_up.reason).toBe('INVALID_PROOF');

    const malformed = await http
      .post('/v1/transfers')
      .set('Authorization', bearer)
      .set('Idempotency-Key', randomUUID())
      .set('X-Step-Up', 'no-es-una-prueba')
      .send(body);
    expect(malformed.status).toBe(400);
    expectContract(malformed, 'createTransfer');

    const del = await http.delete(`/v1/devices/${reg.body.id}`).set('Authorization', bearer);
    expect(del.status).toBe(204);
    const again = await http.delete(`/v1/devices/${reg.body.id}`).set('Authorization', bearer);
    expect(again.status).toBe(404);
    expectContract(again, 'revokeDevice');
  });

  it('rechaza llaves que no son P-256 y exige el scope devices.write', async () => {
    const ana = await customer();
    const bearer = `Bearer ${await mobileToken(ana.sub)}`;
    const p384 = new FakeDevice('secp384r1');
    const res = await http.post('/v1/devices').set('Authorization', bearer).send({ public_key: p384.publicKeyBase64, platform: 'android', name: 'Tel' });
    expect(res.status).toBe(400);
    expectContract(res, 'registerDevice');

    const webToken = await token(ana.sub);
    const noScope = await http.get('/v1/devices').set('Authorization', `Bearer ${webToken}`);
    expect(noScope.status).toBe(403);
  });
});

describe('avisos, fraude y API interna', () => {
  const n8nToken = (scopes = 'internal.notify internal.fraud internal.reconcile') =>
    mintDevToken('n8n-local', scopes, SECRET, '5m', [], 'n8n-local');

  async function riskyTransfer() {
    const ana = await customer(3_000_000);
    const luis = await customer();
    const t = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ source_account_id: ana.account.id, destination_clabe: luis.account.clabe, amount: 1_500_000, concept: 'Enganche' });
    expect(t.status).toBe(201);
    return { ana, luis, transfer: t.body as { id: string } };
  }

  it('la API interna rechaza tokens de usuario aunque traigan el scope', async () => {
    const userWithScope = await mintDevToken('mallory', 'internal.notify', SECRET);
    const res = await http
      .post('/v1/internal/notifications')
      .set('Authorization', `Bearer ${userWithScope}`)
      .send({ event_id: randomUUID(), kind: 'SECURITY', owner_id: 'x', title: 't', body: 'b' });
    expect(res.status).toBe(403);
    expectContract(res, 'createNotification');

    const n8nWithoutScope = await n8nToken('internal.reconcile');
    const res2 = await http.post('/v1/internal/fraud-cases').set('Authorization', `Bearer ${n8nWithoutScope}`).send({ entry_id: randomUUID() });
    expect(res2.status).toBe(403);
  });

  it('n8n crea un aviso (idempotente) y el cliente lo ve y lo marca como leído', async () => {
    const ana = await customer();
    const bearer = `Bearer ${await n8nToken()}`;
    const body = { event_id: randomUUID(), kind: 'WELCOME', account_id: ana.account.id, title: '¡Bienvenida a Ámbar!', body: 'Tu cuenta ya está lista.' };

    const created = await http.post('/v1/internal/notifications').set('Authorization', bearer).send(body);
    expect(created.status).toBe(201);
    expectContract(created, 'createNotification');
    const replay = await http.post('/v1/internal/notifications').set('Authorization', bearer).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.notification.id).toBe(created.body.notification.id);
    expectContract(replay, 'createNotification');

    const both = await http
      .post('/v1/internal/notifications')
      .set('Authorization', bearer)
      .send({ ...body, owner_id: ana.sub });
    expect(both.status).toBe(400);
    expectContract(both, 'createNotification');

    const inbox = await http.get('/v1/notifications').set('Authorization', ana.bearer);
    expect(inbox.status).toBe(200);
    expect(inbox.body.unread_count).toBe(1);
    expectContract(inbox, 'listNotifications');

    const read = await http.post(`/v1/notifications/${created.body.notification.id}/read`).set('Authorization', ana.bearer);
    expect(read.status).toBe(204);
    const other = await customer();
    const notMine = await http.post(`/v1/notifications/${created.body.notification.id}/read`).set('Authorization', other.bearer);
    expect(notMine.status).toBe(404);
    expectContract(notMine, 'markNotificationRead');
  });

  it('flujo completo: caso de fraude → el cliente no lo reconoce → cuenta congelada → operación la libera', async () => {
    const { ana, luis, transfer } = await riskyTransfer();
    const n8n = `Bearer ${await n8nToken()}`;

    const opened = await http.post('/v1/internal/fraud-cases').set('Authorization', n8n).send({ entry_id: transfer.id });
    expect(opened.status).toBe(201);
    expectContract(opened, 'openFraudCase');
    const caseId = opened.body.fraud_case.id;

    const view = await http.get(`/v1/fraud-cases/${caseId}`).set('Authorization', ana.bearer);
    expect(view.status).toBe(200);
    expectContract(view, 'getFraudCase');
    const foreign = await http.get(`/v1/fraud-cases/${caseId}`).set('Authorization', luis.bearer);
    expect(foreign.status).toBe(404);

    const answer = await http.post(`/v1/fraud-cases/${caseId}/answer`).set('Authorization', ana.bearer).send({ recognized: false });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: 'NOT_RECOGNIZED', account_frozen: true });
    expectContract(answer, 'answerFraudCase');

    const flip = await http.post(`/v1/fraud-cases/${caseId}/answer`).set('Authorization', ana.bearer).send({ recognized: true });
    expect(flip.status).toBe(409);
    expect(flip.body.code).toBe('FRAUD_CASE_CLOSED');
    expectContract(flip, 'answerFraudCase');

    const blocked = await http
      .post('/v1/transfers')
      .set('Authorization', ana.bearer)
      .set('Idempotency-Key', randomUUID())
      .send({ source_account_id: ana.account.id, destination_clabe: luis.account.clabe, amount: 100, concept: 'Otra' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('ACCOUNT_NOT_ACTIVE');

    const notOps = await http
      .post(`/v1/admin/accounts/${ana.account.id}/unfreeze`)
      .set('Authorization', `Bearer ${await mintDevToken('ops-x', 'ledger.admin', SECRET)}`)
      .send({ reason: 'Verificado' });
    expect(notOps.status).toBe(403);
    const ops = `Bearer ${await mintDevToken('ops-carlos', 'ledger.admin', SECRET, '5m', ['operators'])}`;
    const unfrozen = await http.post(`/v1/admin/accounts/${ana.account.id}/unfreeze`).set('Authorization', ops).send({ reason: 'Verificado por teléfono' });
    expect(unfrozen.status).toBe(200);
    expect(unfrozen.body.status).toBe('ACTIVE');
    expectContract(unfrozen, 'unfreezeAccount');
  });

  it('el token push se registra en un dispositivo propio y valida el formato', async () => {
    const ana = await customer();
    const bearer = `Bearer ${await mintDevToken(ana.sub, 'devices.write', SECRET)}`;
    const device = new FakeDevice();
    const reg = await http.post('/v1/devices').set('Authorization', bearer).send({ public_key: device.publicKeyBase64, platform: 'ios', name: 'iPhone' });
    expect(reg.status).toBe(201);

    const ok = await http.put(`/v1/devices/${reg.body.id}/push-token`).set('Authorization', bearer).send({ push_token: 'ExponentPushToken[abcdefghijklmnopqrstuv]' });
    expect(ok.status).toBe(204);
    const bad = await http.put(`/v1/devices/${reg.body.id}/push-token`).set('Authorization', bearer).send({ push_token: 'https://evil.example' });
    expect(bad.status).toBe(400);
    expectContract(bad, 'setDevicePushToken');
    const cleared = await http.put(`/v1/devices/${reg.body.id}/push-token`).set('Authorization', bearer).send({ push_token: null });
    expect(cleared.status).toBe(204);
  });

  it('la conciliación interna cumple el contrato', async () => {
    const res = await http.get('/v1/internal/reconciliation').set('Authorization', `Bearer ${await n8nToken('internal.reconcile')}`);
    expect(res.status).toBe(200);
    expect(res.body.ledger.ok).toBe(true);
    expectContract(res, 'getReconciliation');
  });
});
