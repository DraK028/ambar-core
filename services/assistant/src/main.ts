import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { AssistantDeps, AuditRecord } from './application/assistant.service';
import { AppConfig, loadConfig } from './config';
import { DynamoConversationStore, MemoryConversationStore } from './conversation/store';
import { BedrockModel } from './model/bedrock';
import { ScriptedModel } from './model/scripted';
import { httpCoreApi } from './tools/core-api';

export async function createApp(config: AppConfig, deps: AssistantDeps, logger = true): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, deps), {
    bodyParser: false,
    logger: logger ? ['log', 'warn', 'error'] : false,
  });
  app.useBodyParser('json', { limit: '8kb' });
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.set('trust proxy', 1);
  http.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  return app;
}

/** Registro de auditoría: una línea JSON por turno, sin texto del usuario ni del modelo. */
export function jsonAudit(record: AuditRecord): void {
  console.log(JSON.stringify({ level: 'info', ...record, time: new Date().toISOString() }));
}

export function depsFromConfig(config: AppConfig): AssistantDeps {
  const model =
    config.MODEL_PROVIDER === 'bedrock'
      ? new BedrockModel({
          modelId: config.BEDROCK_MODEL_ID!,
          guardrail: config.BEDROCK_GUARDRAIL_ID ? { id: config.BEDROCK_GUARDRAIL_ID, version: config.BEDROCK_GUARDRAIL_VERSION! } : undefined,
        })
      : new ScriptedModel();
  const store = config.CONVERSATION_STORE === 'dynamodb' ? new DynamoConversationStore(config.CONVERSATIONS_TABLE!) : new MemoryConversationStore();
  return {
    model,
    store,
    core: (token) => httpCoreApi(config.CORE_API_URL, token),
    audit: config.LOG_AUDIT ? jsonAudit : () => undefined,
    limits: { dailyMessages: config.DAILY_MESSAGE_LIMIT },
    auditSalt: config.AUDIT_SALT,
  };
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config, depsFromConfig(config));
  const shutdown = () => void app.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  await app.listen(config.PORT);
  console.log(`Asistente de Ámbar en http://localhost:${config.PORT} (env=${config.APP_ENV}, modelo=${config.MODEL_PROVIDER}, conversaciones=${config.CONVERSATION_STORE})`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
