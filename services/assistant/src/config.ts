import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * Configuración del asistente. Fuera de local, el modelo es Bedrock con guardrail, las
 * conversaciones viven en DynamoDB y los tokens se validan contra Cognito: el modelo guionado
 * y el almacén en memoria solo existen para desarrollo y pruebas.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
    PORT: z.coerce.number().int().positive().default(3002),

    AUTH_MODE: z.enum(['local', 'cognito']).default('local'),
    LOCAL_JWT_SECRET: z.string().optional(),
    COGNITO_ISSUER: z.string().url().optional(),
    COGNITO_CLIENT_IDS: z.string().optional(),
    SCOPE_PREFIX: z.string().default('ambar-api/'),

    /** Base del core (en AWS, el NLB interno del Ledger). El asistente llama con el token del usuario. */
    CORE_API_URL: z.string().url(),

    MODEL_PROVIDER: z.enum(['bedrock', 'scripted']).default('scripted'),
    BEDROCK_MODEL_ID: z.string().optional(),
    BEDROCK_GUARDRAIL_ID: z.string().optional(),
    BEDROCK_GUARDRAIL_VERSION: z.string().optional(),
    AWS_REGION: z.string().optional(),

    CONVERSATION_STORE: z.enum(['dynamodb', 'memory']).default('memory'),
    CONVERSATIONS_TABLE: z.string().optional(),

    DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(1000).default(50),
    /** Sal para seudonimizar al usuario en los registros de auditoría. */
    AUDIT_SALT: z.string().min(16).optional(),
    LOG_AUDIT: bool.default('true'),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (c.AUTH_MODE === 'local' && (!c.LOCAL_JWT_SECRET || c.LOCAL_JWT_SECRET.length < 32)) {
      issue('LOCAL_JWT_SECRET', 'Con AUTH_MODE=local se requiere un secreto de al menos 32 caracteres.');
    }
    if (c.AUTH_MODE === 'cognito' && !c.COGNITO_ISSUER) issue('COGNITO_ISSUER', 'Con AUTH_MODE=cognito se requiere COGNITO_ISSUER.');
    if (c.MODEL_PROVIDER === 'bedrock' && !c.BEDROCK_MODEL_ID) issue('BEDROCK_MODEL_ID', 'Con MODEL_PROVIDER=bedrock se requiere el id del modelo o perfil de inferencia.');
    if (c.CONVERSATION_STORE === 'dynamodb' && !c.CONVERSATIONS_TABLE) issue('CONVERSATIONS_TABLE', 'Con CONVERSATION_STORE=dynamodb se requiere la tabla.');
    if (Boolean(c.BEDROCK_GUARDRAIL_ID) !== Boolean(c.BEDROCK_GUARDRAIL_VERSION)) {
      issue('BEDROCK_GUARDRAIL_VERSION', 'El guardrail necesita id y versión.');
    }
    if (c.APP_ENV !== 'local') {
      if (c.AUTH_MODE !== 'cognito') issue('AUTH_MODE', `En APP_ENV=${c.APP_ENV} solo se permite AUTH_MODE=cognito.`);
      if (c.MODEL_PROVIDER !== 'bedrock') issue('MODEL_PROVIDER', 'El modelo guionado es solo para local y pruebas.');
      if (c.CONVERSATION_STORE !== 'dynamodb') issue('CONVERSATION_STORE', 'Fuera de local las conversaciones van a DynamoDB.');
      if (!c.BEDROCK_GUARDRAIL_ID) issue('BEDROCK_GUARDRAIL_ID', 'Fuera de local el modelo siempre pasa por un guardrail de Bedrock.');
      if (!c.AUDIT_SALT) issue('AUDIT_SALT', 'Fuera de local se requiere una sal para seudonimizar la auditoría.');
    }
  });

export type AppConfig = z.infer<typeof schema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración inválida:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
