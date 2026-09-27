import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verify, type EventEnvelope } from '@ambar/events';
import { backoffMs } from './outbox-relay';
import { EventBridgePublisher, WebhookPublisher } from './publishers';

const SECRET = 'secreto-de-webhooks-de-al-menos-32-caracteres';

function envelope(type: string, id = `evt-${Math.random()}`): EventEnvelope {
  return { id, type, source: 'ambar.core', version: 1, occurred_at: '2026-09-01T12:00:00.000Z', aggregate_id: 'agg', data: { amount: 100 } };
}

describe('WebhookPublisher', () => {
  let server: Server;
  let base: string;
  const received: { path: string; body: string; valid: boolean; eventId?: string }[] = [];
  let failPath: string | null = null;

  beforeAll(async () => {
    server = createServer(async (req: IncomingMessage, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const valid = verify(body, req.headers['ambar-signature'] as string, SECRET).ok;
      received.push({ path: req.url!, body, valid, eventId: req.headers['ambar-event-id'] as string });
      res.writeHead(req.url === failPath ? 500 : valid ? 200 : 401).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    received.length = 0;
    failPath = null;
  });

  it('envía cada evento, firmado, a todas sus rutas', async () => {
    const e = envelope('transfer.posted');
    const [r] = await new WebhookPublisher(base, SECRET).publish([e]);
    expect(r).toEqual({ id: e.id, ok: true });
    expect(received.map((x) => x.path).sort()).toEqual(['/webhook/alerta-fraude', '/webhook/movimientos']);
    expect(received.every((x) => x.valid && x.eventId === e.id)).toBe(true);
    expect(JSON.parse(received[0].body)).toEqual(e);
  });

  it('un evento sin rutas se da por publicado sin llamar a n8n', async () => {
    const [r] = await new WebhookPublisher(base, SECRET).publish([envelope('device.registered')]);
    expect(r.ok).toBe(true);
    expect(received).toHaveLength(0);
  });

  it('si una ruta falla, el evento completo queda para reintento', async () => {
    failPath = '/webhook/alerta-fraude';
    const [r] = await new WebhookPublisher(base, SECRET).publish([envelope('transfer.posted')]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('alerta-fraude: HTTP 500');
  });

  it('un n8n inalcanzable es un error reintentable, no una excepción', async () => {
    const [r] = await new WebhookPublisher('http://127.0.0.1:1', SECRET, 500).publish([envelope('account.opened')]);
    expect(r.ok).toBe(false);
  });
});

describe('EventBridgePublisher', () => {
  it('manda lotes de 10 y respeta las fallas parciales', async () => {
    const calls: any[] = [];
    const client = {
      send: jest.fn(async (cmd: any) => {
        calls.push(cmd.input);
        return { Entries: cmd.input.Entries.map((_: unknown, i: number) => (i === 1 ? { ErrorCode: 'ThrottlingException', ErrorMessage: 'lento' } : { EventId: 'x' })) };
      }),
    };
    const events = Array.from({ length: 12 }, (_, i) => envelope('transfer.posted', `e${i}`));
    const results = await new EventBridgePublisher('ambar-dev-core', client as any).publish(events);

    expect(calls).toHaveLength(2);
    expect(calls[0].Entries).toHaveLength(10);
    expect(calls[0].Entries[0]).toMatchObject({ EventBusName: 'ambar-dev-core', Source: 'ambar.core', DetailType: 'transfer.posted' });
    expect(JSON.parse(calls[0].Entries[0].Detail)).toEqual(events[0]);
    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual(['e1', 'e11']);
  });

  it('si la llamada completa falla, todos los eventos del lote fallan', async () => {
    const client = { send: jest.fn(async () => { throw new Error('sin red'); }) };
    const results = await new EventBridgePublisher('bus', client as any).publish([envelope('a'), envelope('b')]);
    expect(results.every((r) => !r.ok && r.error === 'sin red')).toBe(true);
  });
});

describe('backoff', () => {
  it('crece exponencialmente con tope', () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 1000, 600_000))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(20, 1000, 600_000)).toBe(600_000);
  });
});
