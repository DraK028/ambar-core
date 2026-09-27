import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createPool } from '../../src/infrastructure/db';
import { runMigrations } from '../../src/infrastructure/migrate';

declare global {
  // eslint-disable-next-line no-var
  var __AMBAR_PG__: StartedPostgreSqlContainer | undefined;
}

/**
 * Postgres real para integración y e2e.
 * - Por defecto levanta postgres:16-alpine con Testcontainers (requiere Docker).
 * - Si DATABASE_URL_TEST ya está definida, usa esa base (útil en CI con un
 *   service container o en máquinas sin Docker).
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL_TEST) {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('ambar_test')
      .withUsername('ambar')
      .withPassword('ambar')
      .start();
    globalThis.__AMBAR_PG__ = container;
    process.env.DATABASE_URL_TEST = container.getConnectionUri();
  }

  const pool = createPool(process.env.DATABASE_URL_TEST!, 1);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
