import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { AppModule } from './app.module';
import { AppConfig, loadConfig } from './config';
import { createPoolFromConfig } from './infrastructure/db';
import { runMigrations } from './infrastructure/migrate';

/** Crea la app Nest con la configuración de seguridad HTTP. Se reutiliza en las pruebas e2e. */
export async function createApp(config: AppConfig, pool: Pool, logger = true): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, pool), {
    bodyParser: false,
    logger: logger ? ['log', 'warn', 'error'] : false,
  });
  app.useBodyParser('json', { limit: '16kb' });
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.set('trust proxy', 1);
  http.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    next();
  });
  return app;
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const pool = createPoolFromConfig(config);
  if (config.MIGRATE_ON_START) {
    const applied = await runMigrations(pool);
    if (applied.length) console.log(`Migraciones aplicadas: ${applied.join(', ')}`);
  }
  const app = await createApp(config, pool);
  const shutdown = async () => {
    await app.close();
    await pool.end();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await app.listen(config.PORT);
  console.log(`Ámbar Ledger escuchando en http://localhost:${config.PORT} (env=${config.APP_ENV}, auth=${config.AUTH_MODE}, db=${config.DB_AUTH}, qa=${config.ENABLE_QA_ENDPOINTS})`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
