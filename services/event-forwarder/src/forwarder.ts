import { routesFor, webhookHeaders, type EventEnvelope } from '@ambar/events';

/** Tipos mínimos del evento de SQS (evita depender de @types/aws-lambda). */
export interface SqsRecord {
  messageId: string;
  body: string;
  eventSourceARN: string;
}
export interface SqsEvent {
  Records: SqsRecord[];
}
export interface SqsBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}

export interface ForwarderDeps {
  baseUrl: string;
  secret: () => Promise<string>;
  /** Nombre de la cola → flujo de n8n. Cada flujo tiene su cola y su DLQ. */
  queueRoutes: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

/** Cuerpo del mensaje: el evento completo de EventBridge; el sobre del core viaja en `detail`. */
export function parseEnvelope(body: string): EventEnvelope {
  const event = JSON.parse(body) as { source?: string; 'detail-type'?: string; detail?: EventEnvelope };
  const env = event.detail;
  if (event.source !== 'ambar.core' || !env || typeof env.id !== 'string' || typeof env.type !== 'string') {
    throw new Error('El mensaje no es un evento de ambar.core');
  }
  if (event['detail-type'] !== env.type) throw new Error('detail-type no coincide con el tipo del sobre');
  return env;
}

function queueName(arn: string): string {
  return arn.split(':').pop() ?? arn;
}

/**
 * Reenvía cada mensaje al webhook de n8n que le toca. Los mensajes que fallan se reportan en
 * batchItemFailures: SQS los reintenta y, tras varios intentos, los manda a la DLQ de ese flujo.
 * Los demás mensajes del lote no se repiten.
 */
export async function forward(event: SqsEvent, deps: ForwarderDeps): Promise<SqsBatchResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? (() => undefined);
  const secret = await deps.secret();
  const failures: { itemIdentifier: string }[] = [];

  await Promise.all(
    event.Records.map(async (record) => {
      const queue = queueName(record.eventSourceARN);
      try {
        const envelope = parseEnvelope(record.body);
        const routes = deps.queueRoutes[queue] ? [deps.queueRoutes[queue]] : routesFor(envelope.type);
        const body = JSON.stringify(envelope);
        for (const route of routes) {
          const res = await fetchImpl(`${deps.baseUrl.replace(/\/$/, '')}/webhook/${route}`, {
            method: 'POST',
            headers: webhookHeaders(envelope, body, secret),
            body,
            signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
          });
          if (!res.ok) throw new Error(`n8n respondió ${res.status} en ${route}`);
        }
        log('info', 'Evento entregado', { event_id: envelope.id, type: envelope.type, routes, queue });
      } catch (err) {
        log('warn', 'No se pudo entregar el evento', { message_id: record.messageId, queue, error: (err as Error).message });
        failures.push({ itemIdentifier: record.messageId });
      }
    }),
  );
  return { batchItemFailures: failures };
}
