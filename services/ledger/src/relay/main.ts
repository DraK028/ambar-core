import { createServer } from 'node:http';
import { z } from 'zod';
import { loadDbConfig } from '../config';
import { createPoolFromConfig } from '../infrastructure/db';
import { OutboxRelay } from './outbox-relay';
import { EventBridgePublisher, WebhookPublisher, type Publisher } from './publishers';

/**
 * Proceso del relay (misma imagen que el Ledger, otro comando):
 *   node dist/relay/main.js
 *
 * En AWS publica en EventBridge y se conecta como ambar_relay (solo puede leer y marcar
 * el outbox). En local puede mandar los eventos directo a n8n (RELAY_PUBLISHER=webhook).
 */
const relayEnv = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
    RELAY_PUBLISHER: z.enum(['eventbridge', 'webhook']).default('eventbridge'),
    EVENT_BUS_NAME: z.string().optional(),
    N8N_WEBHOOK_BASE_URL: z.string().url().optional(),
    WEBHOOK_SIGNING_SECRET: z.string().min(32).optional(),
    RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    RELAY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(10),
    RELAY_POLL_MS: z.coerce.number().int().min(100).default(5_000),
    RELAY_HEALTH_PORT: z.coerce.number().int().positive().default(3001),
  })
  .superRefine((c, ctx) => {
    if (c.RELAY_PUBLISHER === 'eventbridge' && !c.EVENT_BUS_NAME) {
      ctx.addIssue({ code: 'custom', path: ['EVENT_BUS_NAME'], message: 'obligatoria con RELAY_PUBLISHER=eventbridge' });
    }
    if (c.RELAY_PUBLISHER === 'webhook') {
      if (!c.N8N_WEBHOOK_BASE_URL) ctx.addIssue({ code: 'custom', path: ['N8N_WEBHOOK_BASE_URL'], message: 'obligatoria con RELAY_PUBLISHER=webhook' });
      if (!c.WEBHOOK_SIGNING_SECRET) ctx.addIssue({ code: 'custom', path: ['WEBHOOK_SIGNING_SECRET'], message: 'obligatoria (mínimo 32 caracteres)' });
      if (c.APP_ENV !== 'local') ctx.addIssue({ code: 'custom', path: ['RELAY_PUBLISHER'], message: 'fuera de local el relay publica en EventBridge' });
    }
  });

export type RelayConfig = z.infer<typeof relayEnv>;

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const parsed = relayEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida del relay:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}

export function createPublisher(c: RelayConfig): Publisher {
  return c.RELAY_PUBLISHER === 'eventbridge'
    ? new EventBridgePublisher(c.EVENT_BUS_NAME!)
    : new WebhookPublisher(c.N8N_WEBHOOK_BASE_URL!, c.WEBHOOK_SIGNING_SECRET!);
}

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(
    JSON.stringify({ level: extra && 'error' in extra ? 'warn' : 'info', component: 'outbox-relay', msg, ...extra, time: new Date().toISOString() }),
  );

async function main(): Promise<void> {
  const config = loadRelayConfig();
  const pool = createPoolFromConfig(loadDbConfig(), 4);
  const publisher = createPublisher(config);
  const relay = new OutboxRelay(pool, publisher, {
    batchSize: config.RELAY_BATCH_SIZE,
    maxAttempts: config.RELAY_MAX_ATTEMPTS,
    pollIntervalMs: config.RELAY_POLL_MS,
    log,
  });

  // Health check del contenedor: el ciclo debe haber corrido hace poco.
  const health = createServer((req, res) => {
    const fresh = Date.now() - relay.lastLoopAt < config.RELAY_POLL_MS * 3 + 30_000;
    res.writeHead(req.url === '/health' && fresh ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: fresh ? 'ok' : 'stale', publisher: publisher.name }));
  }).listen(config.RELAY_HEALTH_PORT, '0.0.0.0');

  await relay.start();
  log('Relay iniciado', { publisher: publisher.name });

  const shutdown = async () => {
    log('Deteniendo relay');
    await relay.stop();
    health.close();
    await pool.end();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
