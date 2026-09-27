'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ev = require('..');

const body = JSON.stringify({ id: 'e1', type: 'transfer.posted', data: { amount: 100 } });
const secret = 'secreto-de-prueba-con-longitud-suficiente';

test('firma y verifica un cuerpo', () => {
  const header = ev.sign(body, secret, 1_700_000_000);
  assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assert.deepEqual(ev.verify(body, header, secret, { now: 1_700_000_100 }), { ok: true });
});

test('rechaza un cuerpo alterado, otro secreto o una firma vieja', () => {
  const header = ev.sign(body, secret, 1_700_000_000);
  assert.equal(ev.verify(body.replace('100', '999'), header, secret, { now: 1_700_000_000 }).reason, 'MISMATCH');
  assert.equal(ev.verify(body, header, 'otro-secreto', { now: 1_700_000_000 }).reason, 'MISMATCH');
  assert.equal(ev.verify(body, header, secret, { now: 1_700_000_301 }).reason, 'EXPIRED');
  assert.equal(ev.verify(body, 'basura', secret).reason, 'MALFORMED');
  assert.equal(ev.verify(body, header, []).reason, 'NO_SECRET');
});

test('acepta el secreto anterior durante una rotación', () => {
  const header = ev.sign(body, 'secreto-viejo', 1_700_000_000);
  assert.deepEqual(ev.verify(body, header, ['secreto-nuevo', 'secreto-viejo'], { now: 1_700_000_000 }), { ok: true });
});

test('rutas hacia los flujos de n8n', () => {
  assert.deepEqual(ev.routesFor('transfer.posted'), ['movimientos', 'alerta-fraude']);
  assert.deepEqual(ev.routesFor('device.registered'), []);
  for (const type of Object.keys(ev.ROUTES)) assert.ok(ev.EVENT_TYPES.includes(type), type);
});

test('convierte una fila del outbox en sobre', () => {
  const env = ev.toEnvelope({
    id: 'a', aggregate_id: 'b', event_type: 'account.opened', created_at: new Date('2026-01-01T00:00:00Z'),
    payload: { account_id: 'b', occurred_at: '2026-01-01T00:00:01.000Z' },
  });
  assert.deepEqual(env, {
    id: 'a', type: 'account.opened', source: 'ambar.core', version: 1,
    occurred_at: '2026-01-01T00:00:01.000Z', aggregate_id: 'b', data: { account_id: 'b', occurred_at: '2026-01-01T00:00:01.000Z' },
  });
});
