import { readFileSync } from 'node:fs';
import { Signer } from '@aws-sdk/rds-signer';
import { Pool, PoolClient, PoolConfig, types } from 'pg';
import type { DbConfig } from '../config';

/** Postgres BIGINT (OID 20) → number, fallando si no cabe con precisión exacta. */
function parseBigint(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Valor BIGINT fuera del rango seguro de JavaScript: ${value}`);
  }
  return n;
}
types.setTypeParser(20, parseBigint);

export const PG_POOL = Symbol('PG_POOL');

export function createPool(connectionString: string, max = 20): Pool {
  return new Pool({ connectionString, max, application_name: 'ambar-ledger' });
}

/**
 * Pool según el modo de autenticación configurado.
 * En modo iam, pg pide un token nuevo al abrir cada conexión (el token dura 15 min);
 * las conexiones ya abiertas no se ven afectadas cuando el token expira.
 */
export function createPoolFromConfig(c: DbConfig, max = c.DB_POOL_MAX): Pool {
  const ssl = c.DB_SSL_CA_FILE ? { ca: readFileSync(c.DB_SSL_CA_FILE, 'utf8'), rejectUnauthorized: true } : undefined;
  const common: PoolConfig = { max, ssl, application_name: 'ambar-ledger', idleTimeoutMillis: 60_000 };

  if (c.DB_AUTH === 'url') {
    return new Pool({ ...common, connectionString: c.DATABASE_URL });
  }
  const target = { ...common, host: c.DB_HOST, port: c.DB_PORT, database: c.DB_NAME, user: c.DB_USER };
  if (c.DB_AUTH === 'password') {
    return new Pool({ ...target, password: c.DB_PASSWORD });
  }
  const signer = new Signer({ hostname: c.DB_HOST!, port: c.DB_PORT, username: c.DB_USER!, region: c.AWS_REGION });
  return new Pool({ ...target, password: () => signer.getAuthToken() });
}

/** Códigos de Postgres que indican que la transacción puede reintentarse completa. */
const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

export interface TransactionOptions {
  retries?: number;
}

/**
 * Ejecuta `fn` dentro de una transacción. Si Postgres aborta por deadlock o
 * conflicto de serialización, la reintenta completa (la operación es idempotente
 * porque todo lo anterior se revirtió).
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  { retries = 3 }: TransactionOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.random() * 10));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Error de Postgres con código y constraint, para traducir violaciones conocidas. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
  return {};
}
