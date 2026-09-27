import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { MemoryConversationStore } from '../../src/conversation/store';
import { loadConfig } from '../../src/config';
import { createApp } from '../../src/main';
import { ScriptedModel } from '../../src/model/scripted';
import { httpCoreApi } from '../../src/tools/core-api';
import { expectContract } from '../support/contract';
import { startCoreStub } from '../support/core-server';

const SECRET = 'e2e-secret-que-tiene-al-menos-32-caracteres';
const token = (sub: string, scope = 'assistant.chat accounts.read') =>
  new SignJWT({ scope: scope.split(' ').map((s) => `ambar-api/${s}`).join(' '), token_use: 'access', client_id: 'web' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('ambar-local')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));

let app: INestApplication;
let http: ReturnType<typeof request>;
let stub: Awaited<ReturnType<typeof startCoreStub>>;
let anaToken: string;
const audits: unknown[] = [];

beforeAll(async () => {
  anaToken = await token('ana');
  stub = await startCoreStub(anaToken);
  const config = loadConfig({ LOCAL_JWT_SECRET: SECRET, CORE_API_URL: stub.url });
  app = await createApp(
    config,
    {
      model: new ScriptedModel(),
      store: new MemoryConversationStore(),
      core: (t) => httpCoreApi(stub.url, t),
      audit: (r) => audits.push(r),
      limits: { dailyMessages: 10 },
    },
    false,
  );
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
  await stub.close();
});

const ask = (bearer: string, body: object) => http.post('/v1/assistant/messages').set('Authorization', `Bearer ${bearer}`).send(body);

describe('API del asistente', () => {
  it('/health es público', async () => {
    expect((await http.get('/health')).status).toBe(200);
  });

  it('responde con datos del core consultados con el token del usuario, solo con GET', async () => {
    const res = await ask(anaToken, { message: '¿Cuál es mi saldo?' });
    expect(res.status).toBe(200);
    expectContract(res, 'sendAssistantMessage');
    expect(res.body.reply.text).toContain('$12,845.67');
    expect(res.body.tools_used).toEqual(['consultar_cuentas']);
    expect(stub.requests).toEqual(['GET /v1/accounts']);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('continúa la conversación y la devuelve redactada; otro usuario recibe 404', async () => {
    const first = await ask(anaToken, { message: 'Mi correo es ana@example.com, ¿qué avisos tengo?' });
    expect(first.body.notices).toEqual(['Ocultamos datos personales de tu mensaje antes de procesarlo.']);
    const id = first.body.conversation_id;
    const second = await ask(anaToken, { conversation_id: id, message: '¿Y mis movimientos?' });
    expect(second.status).toBe(200);

    const conv = await http.get(`/v1/assistant/conversations/${id}`).set('Authorization', `Bearer ${anaToken}`);
    expectContract(conv, 'getAssistantConversation');
    expect(conv.body.messages).toHaveLength(4);
    expect(JSON.stringify(conv.body)).not.toContain('ana@example.com');

    const mallory = await token('mallory');
    const foreign = await http.get(`/v1/assistant/conversations/${id}`).set('Authorization', `Bearer ${mallory}`);
    expect(foreign.status).toBe(404);
    expectContract(foreign, 'getAssistantConversation');
    const hijack = await ask(mallory, { conversation_id: id, message: 'hola' });
    expect(hijack.status).toBe(404);

    const del = await http.delete(`/v1/assistant/conversations/${id}`).set('Authorization', `Bearer ${anaToken}`);
    expect(del.status).toBe(204);
    expect((await http.get(`/v1/assistant/conversations/${id}`).set('Authorization', `Bearer ${anaToken}`)).status).toBe(404);
  });

  it('valida el cuerpo, el token y el scope', async () => {
    const empty = await ask(anaToken, { message: '   ' });
    expect(empty.status).toBe(400);
    expectContract(empty, 'sendAssistantMessage');
    expect((await ask(anaToken, { message: 'x'.repeat(1001) })).status).toBe(400);
    expect((await ask(anaToken, { message: 'hola', extra: true })).status).toBe(400);
    expect((await http.post('/v1/assistant/messages').send({ message: 'hola' })).status).toBe(401);
    const noScope = await ask(await token('ana', 'accounts.read'), { message: 'hola' });
    expect(noScope.status).toBe(403);
    expectContract(noScope, 'sendAssistantMessage');
  });

  it('si el core rechaza el token (sesión vencida), responde 401', async () => {
    const other = await token('luis'); // el stub solo acepta el token de Ana
    const res = await ask(other, { message: '¿Cuál es mi saldo?' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('límite diario: 429 con Retry-After', async () => {
    const bob = await token('bob', 'assistant.chat accounts.read');
    for (let i = 0; i < 10; i++) await ask(bob, { message: 'hola' });
    const res = await ask(bob, { message: 'hola' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('3600');
    expectContract(res, 'sendAssistantMessage');
  });

  it('cada turno deja un registro de auditoría', () => {
    expect(audits.length).toBeGreaterThan(3);
    expect(JSON.stringify(audits)).not.toContain('ana@example.com');
  });
});
