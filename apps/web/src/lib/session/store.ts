import 'server-only';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Lo que se guarda por sesión. Los tokens van cifrados (`sealedTokens`), así que ni
 * quien lea la tabla ni un volcado de memoria del almacén expone un token usable.
 */
export interface SessionRecord {
  id: string;
  sub: string;
  email: string | null;
  provider: 'cognito' | 'local';
  sealedTokens: string;
  accessExpiresAt: number;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
}

export interface SessionStore {
  get(id: string): Promise<SessionRecord | null>;
  put(record: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Solo para local y pruebas: se pierde al reiniciar y no se comparte entre réplicas. */
export class MemorySessionStore implements SessionStore {
  private readonly data = new Map<string, SessionRecord>();

  async get(id: string) {
    return this.data.get(id) ?? null;
  }
  async put(record: SessionRecord) {
    this.data.set(record.id, { ...record });
  }
  async delete(id: string) {
    this.data.delete(id);
  }
}

/** Tabla con llave `id` y TTL en `expiresAt` (segundos): DynamoDB borra sesiones vencidas solo. */
export class DynamoSessionStore implements SessionStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    region: string,
  ) {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  async get(id: string) {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { id }, ConsistentRead: true }));
    const item = res.Item as (SessionRecord & { expiresAt: number }) | undefined;
    if (!item) return null;
    const { expiresAt: _ttl, ...record } = item;
    return record;
  }

  async put(record: SessionRecord) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...record, expiresAt: Math.ceil(record.absoluteExpiresAt / 1000) },
      }),
    );
  }

  async delete(id: string) {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { id } }));
  }
}
