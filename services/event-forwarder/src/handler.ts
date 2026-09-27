import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { forward, type SqsBatchResponse, type SqsEvent } from './forwarder';

/**
 * Lambda en la VPC: SQS (una cola por flujo) → n8n (http://n8n.ambar.internal:5678).
 *   N8N_WEBHOOK_BASE_URL   URL interna de n8n
 *   WEBHOOK_SECRET_ARN     secreto de firma en Secrets Manager (o WEBHOOK_SIGNING_SECRET en local)
 *   QUEUE_ROUTES           JSON {"nombre-de-cola": "flujo"}
 */
let cachedSecret: { value: string; at: number } | null = null;
const SECRET_TTL_MS = 5 * 60_000; // rotación: se relee cada 5 minutos

async function secret(): Promise<string> {
  if (process.env.WEBHOOK_SIGNING_SECRET) return process.env.WEBHOOK_SIGNING_SECRET;
  if (cachedSecret && Date.now() - cachedSecret.at < SECRET_TTL_MS) return cachedSecret.value;
  const out = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.WEBHOOK_SECRET_ARN }));
  if (!out.SecretString) throw new Error('El secreto de firma está vacío');
  cachedSecret = { value: out.SecretString, at: Date.now() };
  return cachedSecret.value;
}

const log = (level: string, msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ level, msg, ...extra }));

export async function handler(event: SqsEvent): Promise<SqsBatchResponse> {
  return forward(event, {
    baseUrl: process.env.N8N_WEBHOOK_BASE_URL ?? 'http://n8n.ambar.internal:5678',
    secret,
    queueRoutes: JSON.parse(process.env.QUEUE_ROUTES ?? '{}'),
    log,
  });
}
