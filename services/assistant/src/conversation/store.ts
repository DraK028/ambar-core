import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Conversaciones: solo texto ya redactado (sin resultados de herramientas: cada turno vuelve a
 * consultar datos frescos al core), con vencimiento automático. El usuario puede borrarlas.
 */
export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  owner_id: string;
  messages: StoredMessage[];
  created_at: string;
  expires_at: string;
  version: number;
}

export class ConversationConflictError extends Error {}

export interface ConversationStore {
  get(id: string): Promise<Conversation | null>;
  /** Guarda si la versión guardada es `expectedVersion` (0 = nueva); si no, ConversationConflictError. */
  save(conversation: Conversation, expectedVersion: number): Promise<void>;
  delete(id: string, ownerId: string): Promise<boolean>;
  /** Suma uno al contador diario del usuario y devuelve el nuevo total. */
  incrementDailyUsage(ownerId: string, day: string, ttlSeconds: number): Promise<number>;
}

export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly usage = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async get(id: string): Promise<Conversation | null> {
    const c = this.conversations.get(id);
    if (!c) return null;
    if (new Date(c.expires_at) <= this.now()) {
      this.conversations.delete(id);
      return null;
    }
    return structuredClone(c);
  }

  async save(conversation: Conversation, expectedVersion: number): Promise<void> {
    const current = this.conversations.get(conversation.id);
    if ((current?.version ?? 0) !== expectedVersion) throw new ConversationConflictError();
    this.conversations.set(conversation.id, structuredClone(conversation));
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const c = this.conversations.get(id);
    if (!c || c.owner_id !== ownerId) return false;
    return this.conversations.delete(id);
  }

  async incrementDailyUsage(ownerId: string, day: string): Promise<number> {
    const key = `${ownerId}#${day}`;
    const n = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, n);
    return n;
  }
}

/**
 * DynamoDB: pk = "conv#<id>" o "usage#<owner>#<día>", TTL en el atributo `ttl`.
 * La tabla se cifra con KMS y DynamoDB borra lo vencido por sí sola.
 */
export class DynamoConversationStore implements ConversationStore {
  private readonly doc: Pick<DynamoDBDocumentClient, 'send'>;

  constructor(
    private readonly table: string,
    client?: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  }

  async get(id: string): Promise<Conversation | null> {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: `conv#${id}` }, ConsistentRead: true }));
    const item = out.Item as (Conversation & { pk: string; ttl: number }) | undefined;
    if (!item || item.ttl * 1000 <= this.now().getTime()) return null; // el TTL de DynamoDB borra con retraso
    const { pk: _pk, ttl: _ttl, ...conversation } = item;
    return conversation;
  }

  async save(conversation: Conversation, expectedVersion: number): Promise<void> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `conv#${conversation.id}`, ttl: Math.floor(new Date(conversation.expires_at).getTime() / 1000), ...conversation },
          ConditionExpression: expectedVersion === 0 ? 'attribute_not_exists(pk)' : '#v = :expected',
          ...(expectedVersion === 0 ? {} : { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':expected': expectedVersion } }),
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException || (err as Error).name === 'ConditionalCheckFailedException') {
        throw new ConversationConflictError();
      }
      throw err;
    }
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    try {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { pk: `conv#${id}` },
          ConditionExpression: 'owner_id = :owner',
          ExpressionAttributeValues: { ':owner': ownerId },
        }),
      );
      return true;
    } catch (err) {
      if ((err as Error).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async incrementDailyUsage(ownerId: string, day: string, ttlSeconds: number): Promise<number> {
    const out = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: `usage#${ownerId}#${day}` },
        UpdateExpression: 'ADD #n :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ExpressionAttributeNames: { '#n': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':ttl': Math.floor(this.now().getTime() / 1000) + ttlSeconds },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(out.Attributes?.count ?? 1);
  }
}
