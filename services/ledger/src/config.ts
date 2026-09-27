import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * Conexión a Postgres. Tres modos:
 *   url      → DATABASE_URL (local, pruebas)
 *   password → DB_HOST/DB_USER/DB_PASSWORD (tarea de migraciones con el secreto de RDS)
 *   iam      → DB_HOST/DB_USER + token IAM de 15 min (servicio en ECS; sin contraseña guardada)
 */
const dbFields = z.object({
  DB_AUTH: z.enum(['url', 'password', 'iam']).default('url'),
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('ambar'),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  AWS_REGION: z.string().optional(),
  /** Bundle de CAs de RDS; si se define, la conexión exige TLS y valida el certificado. */
  DB_SSL_CA_FILE: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
});

export type DbConfig = z.infer<typeof dbFields>;

function refineDb(c: DbConfig, ctx: z.RefinementCtx): void {
  const need = (field: keyof DbConfig) => {
    if (!c[field]) ctx.addIssue({ code: 'custom', path: [field], message: `${field} es obligatoria con DB_AUTH=${c.DB_AUTH}` });
  };
  if (c.DB_AUTH === 'url') need('DATABASE_URL');
  if (c.DB_AUTH === 'password') ['DB_HOST', 'DB_USER', 'DB_PASSWORD'].forEach((f) => need(f as keyof DbConfig));
  if (c.DB_AUTH === 'iam') ['DB_HOST', 'DB_USER', 'AWS_REGION'].forEach((f) => need(f as keyof DbConfig));
}

const appFields = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Entorno lógico. Las reglas de seguridad dependen de este valor, no de NODE_ENV. */
  APP_ENV: z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  MIGRATE_ON_START: bool,

  /** local: tokens HS256 firmados con LOCAL_JWT_SECRET. cognito: JWKS del user pool. */
  AUTH_MODE: z.enum(['local', 'cognito']).default('local'),
  LOCAL_JWT_SECRET: z.string().optional(),
  COGNITO_ISSUER: z.string().url().optional(),
  /** Lista separada por comas de app clients aceptados (claim client_id). */
  COGNITO_CLIENT_IDS: z.string().optional(),
  /** Prefijo del resource server en los scopes de Cognito, p. ej. "ambar-api/". */
  SCOPE_PREFIX: z.string().default('ambar-api/'),
  /**
   * En Cognito los scopes pertenecen al app client, no al usuario. Por eso
   * ledger.admin además exige que el usuario esté en este grupo.
   */
  ADMIN_GROUP: z.string().min(1).default('operators'),

  ENABLE_QA_ENDPOINTS: bool,

  /** Transferencias desde estos app clients exigen firma del dispositivo según la política. */
  STEP_UP_CLIENT_IDS: z.string().default('ambar-local-mobile'),
  /** app clients máquina a máquina que pueden llamar /v1/internal/* (n8n). */
  INTERNAL_CLIENT_IDS: z.string().default('n8n-local'),

  /** Monto (centavos) desde el cual se exige step-up. Por defecto $5,000.00. */
  STEP_UP_THRESHOLD: z.coerce.number().int().positive().default(500_000),
});

const schema = dbFields.merge(appFields).superRefine((c, ctx) => {
  refineDb(c, ctx);
  if (c.AUTH_MODE === 'local' && (!c.LOCAL_JWT_SECRET || c.LOCAL_JWT_SECRET.length < 32)) {
    ctx.addIssue({ code: 'custom', path: ['LOCAL_JWT_SECRET'], message: 'Con AUTH_MODE=local se requiere un secreto de al menos 32 caracteres.' });
  }
  if (c.AUTH_MODE === 'cognito' && !c.COGNITO_ISSUER) {
    ctx.addIssue({ code: 'custom', path: ['COGNITO_ISSUER'], message: 'Con AUTH_MODE=cognito se requiere COGNITO_ISSUER.' });
  }
  if (c.APP_ENV !== 'local' && c.AUTH_MODE !== 'cognito') {
    ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: `En APP_ENV=${c.APP_ENV} solo se permite AUTH_MODE=cognito.` });
  }
  if (c.APP_ENV === 'prod' && c.ENABLE_QA_ENDPOINTS) {
    ctx.addIssue({ code: 'custom', path: ['ENABLE_QA_ENDPOINTS'], message: 'Los endpoints de QA no pueden habilitarse en producción.' });
  }
  if (c.APP_ENV !== 'local' && c.DB_AUTH !== 'url' && !c.DB_SSL_CA_FILE) {
    ctx.addIssue({ code: 'custom', path: ['DB_SSL_CA_FILE'], message: 'Fuera de local la conexión a la base debe usar TLS verificado.' });
  }
});

export type AppConfig = z.infer<typeof schema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

function parse<T extends z.ZodTypeAny>(s: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = s.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración inválida:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return parse(schema, env);
}

/** Solo la parte de base de datos (migraciones, conciliación, seed). */
export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return parse(dbFields.superRefine(refineDb), env);
}
