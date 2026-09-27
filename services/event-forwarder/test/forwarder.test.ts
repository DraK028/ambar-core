import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verify } from '@ambar/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forward, parseEnvelope, type SqsRecord } from '../src/forwarder';

const SECRET = 'secreto-de-webhooks-de-al-menos-32-caracteres';
const received: { path: string; valid: boolean; body: any }[] = [];
let failing = new Set<string>();
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Servidor que hace de n8n: verifica la firma como lo hace el nodo Code de cada flujo.
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const valid = verify(raw, req.headers['ambar-signature'] as string, SECRET).ok;
    received.push({ path: req.url!, valid, body: JSON.parse(raw) });
    res.writeHead(failing.has(req.url!) ? 503 : valid ? 200 : 401).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  received.length = 0;
  failing = new Set();
});

const envelope = (type: string, id: string) => ({ id, type, source: 'ambar.core', version: 1, occurred_at: '2026-09-01T00:00:00Z', aggregate_id: 'a', data: { amount: 1 } });
const record = (messageId: string, type: string, queue: string, id = messageId): SqsRecord => ({
  messageId,
  eventSourceARN: `arn:aws:sqs:us-east-1:123456789012:${queue}`,
  body: JSON.stringify({ version: '0', id: 'eb-1', source: 'ambar.core', 'detail-type': type, detail: envelope(type, id) }),
});

const deps = () => ({
  baseUrl,
  secret: async () => SECRET,
  queueRoutes: { 'ambar-dev-n8n-alerta-fraude': 'alerta-fraude', 'ambar-dev-n8n-movimientos': 'movimientos' },
});

describe('forwarder', () => {
  it('cada cola entrega solo a su flujo, con el sobre firmado', async () => {
    const out = await forward(
      { Records: [record('m1', 'transfer.posted', 'ambar-dev-n8n-alerta-fraude'), record('m2', 'transfer.posted', 'ambar-dev-n8n-movimientos')] },
      deps(),
    );
    expect(out.batchItemFailures).toEqual([]);
    expect(received.map((r) => r.path).sort()).toEqual(['/webhook/alerta-fraude', '/webhook/movimientos']);
    expect(received.every((r) => r.valid)).toBe(true);
    expect(received[0].body).toMatchObject({ type: 'transfer.posted', source: 'ambar.core' });
  });

  it('una cola sin mapa usa las rutas por tipo de evento', async () => {
    await forward({ Records: [record('m1', 'transfer.posted', 'otra-cola')] }, deps());
    expect(received.map((r) => r.path).sort()).toEqual(['/webhook/alerta-fraude', '/webhook/movimientos']);
  });

  it('reporta solo los mensajes que fallaron para que SQS los reintente', async () => {
    failing.add('/webhook/movimientos');
    const out = await forward(
      { Records: [record('ok', 'transfer.posted', 'ambar-dev-n8n-alerta-fraude'), record('ko', 'deposit.posted', 'ambar-dev-n8n-movimientos')] },
      deps(),
    );
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'ko' }]);
  });

  it('un mensaje que no es del core va a reintento/DLQ, no se reenvía', async () => {
    const bad: SqsRecord = { messageId: 'x', eventSourceARN: 'arn:aws:sqs:us-east-1:1:q', body: JSON.stringify({ source: 'otro', detail: {} }) };
    const out = await forward({ Records: [bad] }, deps());
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'x' }]);
    expect(received).toHaveLength(0);
    expect(() => parseEnvelope('{"source":"ambar.core","detail-type":"a","detail":{"id":"1","type":"b"}}')).toThrow(/detail-type/);
  });

  it('n8n caído no rompe el lote: todos los mensajes se reportan como fallidos', async () => {
    const out = await forward({ Records: [record('a', 'account.opened', 'q')] }, { ...deps(), baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'a' }]);
  });
});
