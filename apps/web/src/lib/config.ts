import 'server-only';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
    /** URL pública de la banca web; define redirect_uri, cookies seguras y la verificación de Origin. */
    APP_URL: z.string().url().default('http://localhost:3001'),
    /** Base de la API del core: API Gateway en AWS, el Ledger directo en local. */
    LEDGER_API_URL: z.string().url().default('http://localhost:3000'),
    /** Base del asistente. En AWS es la misma de API Gateway (ruta /v1/assistant); en local, su propio puerto. */
    ASSISTANT_API_URL: z.string().url().optional(),

    AUTH_PROVIDER: z.enum(['cognito', 'local']).default('local'),
    COGNITO_DOMAIN: z.string().url().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
    COGNITO_CLIENT_SECRET: z.string().optional(),
    COGNITO_ISSUER: z.string().url().optional(),
    LOCAL_JWT_SECRET: z.string().optional(),

    /** Cifra la cookie de la transacción OAuth y los tokens guardados en la sesión. */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
    SESSION_STORE: z.enum(['memory', 'dynamodb']).default('memory'),
    SESSIONS_TABLE: z.string().optional(),
    AWS_REGION: z.string().optional(),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    SHOW_DEMO_USERS: bool.default('false'),
  })
  .superRefine((c, ctx) => {
    const need = (k: keyof typeof c, why: string) => {
      if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} es obligatoria ${why}` });
    };
    if (c.AUTH_PROVIDER === 'cognito') {
      (['COGNITO_DOMAIN', 'COGNITO_CLIENT_ID', 'COGNITO_CLIENT_SECRET', 'COGNITO_ISSUER'] as const).forEach((k) =>
        need(k, 'con AUTH_PROVIDER=cognito'),
      );
    }
    if (c.AUTH_PROVIDER === 'local') need('LOCAL_JWT_SECRET', 'con AUTH_PROVIDER=local');
    if (c.SESSION_STORE === 'dynamodb') {
      need('SESSIONS_TABLE', 'con SESSION_STORE=dynamodb');
      need('AWS_REGION', 'con SESSION_STORE=dynamodb');
    }
    if (c.APP_ENV !== 'local') {
      if (c.AUTH_PROVIDER !== 'cognito') {
        ctx.addIssue({ code: 'custom', path: ['AUTH_PROVIDER'], message: `En APP_ENV=${c.APP_ENV} solo se permite Cognito.` });
      }
      if (c.SESSION_STORE !== 'dynamodb') {
        ctx.addIssue({ code: 'custom', path: ['SESSION_STORE'], message: 'Fuera de local las sesiones deben vivir en DynamoDB (varias réplicas).' });
      }
      if (!c.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Fuera de local la banca web debe servirse por HTTPS.' });
      }
    }
  });

export type WebConfig = z.infer<typeof schema> & { secureCookies: boolean; origin: string };

export function parseConfig(env: Record<string, string | undefined>): WebConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración inválida de la banca web:\n${lines.join('\n')}`);
  }
  const url = new URL(parsed.data.APP_URL);
  return { ...parsed.data, secureCookies: url.protocol === 'https:', origin: url.origin };
}

let cached: WebConfig | undefined;

/** Se lee en tiempo de ejecución (no de compilación): la misma imagen sirve para cualquier entorno. */
export function config(): WebConfig {
  cached ??= parseConfig(process.env);
  return cached;
}
