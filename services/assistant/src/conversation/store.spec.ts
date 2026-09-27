import { ConversationConflictError, DynamoConversationStore, MemoryConversationStore, type Conversation } from './store';

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  owner_id: 'ana',
  messages: [],
  created_at: '2026-09-27T10:00:00.000Z',
  expires_at: '2026-09-28T10:00:00.000Z',
  version: 1,
  ...over,
});

describe('almacén en memoria', () => {
  it('guarda con control de versión, vence y solo borra el dueño', async () => {
    let now = new Date('2026-09-27T12:00:00Z');
    const store = new MemoryConversationStore(() => now);
    await store.save(conv(), 0);
    await expect(store.save(conv(), 0)).rejects.toBeInstanceOf(ConversationConflictError);
    await store.save(conv({ version: 2 }), 1);
    expect((await store.get('c1'))?.version).toBe(2);
    expect(await store.delete('c1', 'mallory')).toBe(false);
    now = new Date('2026-09-29T00:00:00Z');
    expect(await store.get('c1')).toBeNull();
    expect(await store.incrementDailyUsage('ana', '2026-09-29')).toBe(1);
    expect(await store.incrementDailyUsage('ana', '2026-09-29')).toBe(2);
  });
});

describe('almacén en DynamoDB', () => {
  function fake(responses: Record<string, unknown> = {}) {
    const sent: any[] = [];
    const client = {
      send: jest.fn(async (cmd: any) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        const r = responses[cmd.constructor.name];
        if (r instanceof Error) throw r;
        return r ?? {};
      }),
    };
    return { client, sent };
  }
  const conditional = Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' });
  const now = () => new Date('2026-09-27T12:00:00Z');

  it('crear exige que no exista; actualizar exige la versión esperada; el TTL sale de expires_at', async () => {
    const { client, sent } = fake();
    const store = new DynamoConversationStore('tabla', client as any, now);
    await store.save(conv(), 0);
    await store.save(conv({ version: 2 }), 1);
    expect(sent[0].input).toMatchObject({ TableName: 'tabla', ConditionExpression: 'attribute_not_exists(pk)', Item: { pk: 'conv#c1', ttl: 1790589600 } });
    expect(sent[1].input).toMatchObject({ ConditionExpression: '#v = :expected', ExpressionAttributeValues: { ':expected': 1 } });
  });

  it('una condición fallida es un conflicto', async () => {
    const store = new DynamoConversationStore('t', fake({ PutCommand: conditional }).client as any, now);
    await expect(store.save(conv(), 0)).rejects.toBeInstanceOf(ConversationConflictError);
  });

  it('ignora lo vencido aunque DynamoDB aún no lo borre, y quita las llaves internas', async () => {
    const item = { ...conv(), pk: 'conv#c1', ttl: Math.floor(now().getTime() / 1000) + 60 };
    const store = new DynamoConversationStore('t', fake({ GetCommand: { Item: item } }).client as any, now);
    expect(await store.get('c1')).toEqual(conv());
    const expired = new DynamoConversationStore('t', fake({ GetCommand: { Item: { ...item, ttl: 1 } } }).client as any, now);
    expect(await expired.get('c1')).toBeNull();
  });

  it('borrar solo con el dueño correcto; contador diario atómico', async () => {
    const denied = new DynamoConversationStore('t', fake({ DeleteCommand: conditional }).client as any, now);
    expect(await denied.delete('c1', 'mallory')).toBe(false);
    const { client, sent } = fake({ UpdateCommand: { Attributes: { count: 7 } } });
    const store = new DynamoConversationStore('t', client as any, now);
    expect(await store.delete('c1', 'ana')).toBe(true);
    expect(await store.incrementDailyUsage('ana', '2026-09-27', 3600)).toBe(7);
    expect(sent[1].input).toMatchObject({ Key: { pk: 'usage#ana#2026-09-27' }, UpdateExpression: 'ADD #n :one SET #ttl = if_not_exists(#ttl, :ttl)' });
  });
});
