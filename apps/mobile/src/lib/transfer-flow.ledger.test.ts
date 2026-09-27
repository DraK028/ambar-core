import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { createAmbarClient } from '@ambar/api-client';
import { describe, expect, it } from 'vitest';
import { transferApi } from './api-adapter';
import { submitTransfer } from './transfer-flow';

/**
 * Prueba de integración contra un Ledger real (se omite si no hay LEDGER_URL):
 * el mismo flujo que usa la app, con una llave P-256 de software en lugar del chip.
 *   LEDGER_URL=http://localhost:3000 LOCAL_JWT_SECRET=... npm test -w @ambar/mobile
 */
const LEDGER = process.env.LEDGER_URL;
const SECRET = process.env.LOCAL_JWT_SECRET ?? '';

async function token(sub: string, clientId: string, scopes: string[]) {
  return new SignJWT({ scope: scopes.map((s) => `ambar-api/${s}`).join(' '), token_use: 'access', client_id: clientId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('ambar-local')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));
}

describe.skipIf(!LEDGER)('flujo móvil contra el Ledger real', () => {
  it('transferencia de $7,500 a un beneficiario nuevo: step-up con firma P-256 y dinero movido una vez', async () => {
    const sub = `mobile-${randomUUID().slice(0, 8)}`;
    const mobile = createAmbarClient(LEDGER!, await token(sub, 'ambar-local-mobile', ['accounts.read', 'accounts.write', 'transfers.write', 'devices.write']));
    const qa = createAmbarClient(LEDGER!, await token('qa-bot', 'qa', ['qa.write']));

    const { data: mine } = await mobile.POST('/v1/accounts');
    const { data: other } = await createAmbarClient(LEDGER!, await token(`dest-${sub}`, 'x', ['accounts.write'])).POST('/v1/accounts');
    await qa.POST('/v1/qa/deposits', {
      params: { header: { 'Idempotency-Key': randomUUID() } },
      body: { account_id: mine!.id, amount: 1_000_000, concept: 'Fondeo' },
    });

    // "Chip" de software: misma curva y formato de firma que Keystore / Secure Enclave.
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const { data: device } = await mobile.POST('/v1/devices', {
      body: { public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), platform: 'android', name: 'Prueba' },
    });

    let prompts = 0;
    const signer = {
      sign: async (payload: string) => {
        prompts++;
        return nodeSign('sha256', Buffer.from(payload), { key: privateKey, dsaEncoding: 'der' }).toString('base64');
      },
    };
    const op = { source_account_id: mine!.id, destination_clabe: other!.clabe, amount: 750_000, concept: 'Enganche' };
    const key = randomUUID();

    const out = await submitTransfer({ api: transferApi(mobile), signer, deviceId: device!.id }, op, key);
    expect(out).toMatchObject({ status: 'done', confirmedWithDevice: true });
    expect(prompts).toBe(1);

    // Reintento por red caída: misma llave, sin biometría, sin doble cargo.
    const retry = await submitTransfer({ api: transferApi(mobile), signer, deviceId: device!.id }, op, key);
    expect(retry).toMatchObject({ status: 'done', confirmedWithDevice: false });
    const { data: after } = await mobile.GET('/v1/accounts/{accountId}', { params: { path: { accountId: mine!.id } } });
    expect(after!.balance).toBe(250_000);
  });
});
