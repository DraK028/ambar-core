#!/usr/bin/env node
/**
 * Prueba de punta a punta de la automatización, contra servicios locales ya levantados:
 *   Ledger (3000) → outbox → relay (RELAY_PUBLISHER=webhook) → n8n (5678) → API interna del core
 *
 *   LOCAL_JWT_SECRET=... node automation/n8n/e2e-local.mjs
 *
 * Recorre: bienvenida → avisos de movimientos → transferencia riesgosa → caso de fraude →
 * "no la reconozco" → cuenta congelada → aviso ACCOUNT_FROZEN (+ alerta a operación si
 * OPS_CAPTURE_FILE apunta al archivo donde un servidor local guarda lo que recibe).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../services/ledger/package.json', import.meta.url));
const { SignJWT } = require('jose');

const CORE = process.env.AMBAR_CORE_URL ?? 'http://127.0.0.1:3000';
const SECRET = process.env.LOCAL_JWT_SECRET;
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 20_000);
if (!SECRET) {
  console.error('Define LOCAL_JWT_SECRET (el mismo del Ledger).');
  process.exit(2);
}

const scopes = ['accounts.read', 'accounts.write', 'transfers.write', 'qa.write'].map((s) => `ambar-api/${s}`).join(' ');
const token = (sub) =>
  new SignJWT({ scope: scopes, token_use: 'access', client_id: 'ambar-local-client' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('ambar-local')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(SECRET));

async function api(bearer, method, path, body, headers = {}) {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return json;
}

async function waitFor(what, fn) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) {
      console.log(`  ✓ ${what} (${Date.now() - started} ms)`);
      return value;
    }
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`Tiempo agotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const inbox = (bearer) => api(bearer, 'GET', '/v1/notifications');
const hasKind = (bearer, kind, extra = () => true) => async () =>
  (await inbox(bearer)).data.find((n) => n.kind === kind && extra(n));

async function customer(name, deposit = 0) {
  const sub = `e2e-${name}-${randomUUID().slice(0, 8)}`;
  const bearer = await token(sub);
  const account = await api(bearer, 'POST', '/v1/accounts');
  if (deposit) {
    await api(bearer, 'POST', '/v1/qa/deposits', { account_id: account.id, amount: deposit, concept: 'Nómina' }, { 'idempotency-key': randomUUID() });
  }
  return { sub, bearer, account };
}

const transfer = (from, to, amount, concept) =>
  api(from.bearer, 'POST', '/v1/transfers', { source_account_id: from.account.id, destination_clabe: to.account.clabe, amount, concept }, { 'idempotency-key': randomUUID() });

console.log('1. Onboarding');
const ana = await customer('ana', 3_000_000);
const luis = await customer('luis');
const eva = await customer('eva');
await waitFor('Ana recibe WELCOME', hasKind(ana.bearer, 'WELCOME'));
await waitFor('Ana recibe DEPOSIT_RECEIVED por su nómina', hasKind(ana.bearer, 'DEPOSIT_RECEIVED'));

console.log('2. Movimientos');
await transfer(ana, luis, 10_000, 'Comida');
await waitFor('Ana recibe TRANSFER_SENT', hasKind(ana.bearer, 'TRANSFER_SENT'));
await waitFor('Luis recibe TRANSFER_RECEIVED', hasKind(luis.bearer, 'TRANSFER_RECEIVED'));

console.log('3. Transferencia riesgosa → caso de fraude');
const risky = await transfer(ana, eva, 1_500_000, 'Enganche'); // beneficiaria nueva y 150× su promedio
const check = await waitFor('Ana recibe FRAUD_CHECK', hasKind(ana.bearer, 'FRAUD_CHECK', (n) => n.data.entry_id === risky.id));
const caseId = check.data.fraud_case_id;
const fraudCase = await api(ana.bearer, 'GET', `/v1/fraud-cases/${caseId}`);
console.log(`  · caso ${caseId}: ${fraudCase.status}, motivos ${fraudCase.reasons.join(', ')}`);

console.log('4. "No la reconozco" → cuenta congelada');
const answer = await api(ana.bearer, 'POST', `/v1/fraud-cases/${caseId}/answer`, { recognized: false });
if (!answer.account_frozen) throw new Error('La cuenta debió congelarse');
const account = await api(ana.bearer, 'GET', `/v1/accounts/${ana.account.id}`);
console.log(`  ✓ cuenta ${account.status}`);
await waitFor('Ana recibe ACCOUNT_FROZEN', hasKind(ana.bearer, 'ACCOUNT_FROZEN', (n) => n.data.fraud_case_id === caseId));

const opsFile = process.env.OPS_CAPTURE_FILE;
if (opsFile) {
  await waitFor('operación recibe la alerta del caso', () =>
    existsSync(opsFile) && readFileSync(opsFile, 'utf8').split('\n').some((l) => l.includes(caseId)),
  );
}

console.log('5. Los reintentos no duplican avisos');
const kinds = (await inbox(ana.bearer)).data.map((n) => n.kind);
const counts = kinds.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
console.log(`  · bandeja de Ana: ${JSON.stringify(counts)}`);
if (counts.FRAUD_CHECK !== 1 || counts.ACCOUNT_FROZEN !== 1 || counts.WELCOME !== 1) throw new Error('Avisos duplicados o faltantes');

console.log('\nFlujo completo verificado ✅');
