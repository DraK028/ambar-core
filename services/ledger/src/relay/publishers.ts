import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { routesFor, SOURCE, webhookHeaders, type EventEnvelope } from '@ambar/events';

export interface PublishResult {
  id: string;
  ok: boolean;
  error?: string;
}

/** Destino de los eventos. Debe devolver un resultado por evento, en cualquier orden. */
export interface Publisher {
  readonly name: string;
  publish(events: EventEnvelope[]): Promise<PublishResult[]>;
}

const PUT_EVENTS_MAX = 10;

/**
 * AWS: bus de EventBridge. Las reglas del bus deciden a dónde va cada tipo
 * (SQS → Lambda → n8n, archivo, otros consumidores). PutEvents puede fallar
 * parcialmente: se revisa el resultado de cada entrada.
 */
export class EventBridgePublisher implements Publisher {
  readonly name = 'eventbridge';

  constructor(
    private readonly busName: string,
    private readonly client: Pick<EventBridgeClient, 'send'> = new EventBridgeClient({}),
  ) {}

  async publish(events: EventEnvelope[]): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (let i = 0; i < events.length; i += PUT_EVENTS_MAX) {
      const chunk = events.slice(i, i + PUT_EVENTS_MAX);
      try {
        const out = await this.client.send(
          new PutEventsCommand({
            Entries: chunk.map((e) => ({
              EventBusName: this.busName,
              Source: SOURCE,
              DetailType: e.type,
              Detail: JSON.stringify(e),
              Time: new Date(e.occurred_at),
            })),
          }),
        );
        chunk.forEach((e, j) => {
          const entry = out.Entries?.[j];
          results.push(entry?.ErrorCode ? { id: e.id, ok: false, error: `${entry.ErrorCode}: ${entry.ErrorMessage ?? ''}` } : { id: e.id, ok: true });
        });
      } catch (err) {
        chunk.forEach((e) => results.push({ id: e.id, ok: false, error: (err as Error).message }));
      }
    }
    return results;
  }
}

/**
 * Local: manda cada evento directo a los webhooks de n8n que le corresponden, firmado con HMAC.
 * Un evento sin rutas se da por publicado. Si alguna ruta falla, se reintenta el evento completo
 * (los flujos de n8n son idempotentes por id de evento).
 */
export class WebhookPublisher implements Publisher {
  readonly name = 'webhook';

  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publish(events: EventEnvelope[]): Promise<PublishResult[]> {
    return Promise.all(events.map((e) => this.publishOne(e)));
  }

  private async publishOne(e: EventEnvelope): Promise<PublishResult> {
    const body = JSON.stringify(e);
    const errors: string[] = [];
    for (const route of routesFor(e.type)) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/webhook/${route}`, {
          method: 'POST',
          headers: webhookHeaders(e, body, this.secret),
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) errors.push(`${route}: HTTP ${res.status}`);
      } catch (err) {
        errors.push(`${route}: ${(err as Error).message}`);
      }
    }
    return errors.length ? { id: e.id, ok: false, error: errors.join('; ') } : { id: e.id, ok: true };
  }
}

/** Pruebas y diagnóstico: guarda los eventos en memoria; puede simular fallas. */
export class MemoryPublisher implements Publisher {
  readonly name = 'memory';
  readonly published: EventEnvelope[] = [];
  failIds = new Set<string>();

  async publish(events: EventEnvelope[]): Promise<PublishResult[]> {
    return events.map((e) => {
      if (this.failIds.has(e.id)) return { id: e.id, ok: false, error: 'falla simulada' };
      this.published.push(e);
      return { id: e.id, ok: true };
    });
  }
}
