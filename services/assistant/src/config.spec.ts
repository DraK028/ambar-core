import { loadConfig } from './config';

const local = { LOCAL_JWT_SECRET: 'x'.repeat(32), CORE_API_URL: 'http://localhost:3000' };

describe('configuración', () => {
  it('en local usa el modelo guionado y memoria por defecto', () => {
    expect(loadConfig(local)).toMatchObject({ MODEL_PROVIDER: 'scripted', CONVERSATION_STORE: 'memory', PORT: 3002 });
  });

  it('fuera de local exige Cognito, Bedrock con guardrail, DynamoDB y sal de auditoría', () => {
    expect(() => loadConfig({ ...local, APP_ENV: 'dev' })).toThrow(
      /AUTH_MODE[\s\S]*MODEL_PROVIDER[\s\S]*CONVERSATION_STORE[\s\S]*BEDROCK_GUARDRAIL_ID[\s\S]*AUDIT_SALT/,
    );
    const ok = loadConfig({
      APP_ENV: 'prod',
      AUTH_MODE: 'cognito',
      COGNITO_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/pool',
      CORE_API_URL: 'http://core',
      MODEL_PROVIDER: 'bedrock',
      BEDROCK_MODEL_ID: 'perfil-de-inferencia',
      BEDROCK_GUARDRAIL_ID: 'gr',
      BEDROCK_GUARDRAIL_VERSION: '1',
      CONVERSATION_STORE: 'dynamodb',
      CONVERSATIONS_TABLE: 'tabla',
      AUDIT_SALT: 's'.repeat(16),
    });
    expect(ok.MODEL_PROVIDER).toBe('bedrock');
  });

  it('el guardrail necesita id y versión juntos', () => {
    expect(() => loadConfig({ ...local, BEDROCK_GUARDRAIL_ID: 'gr' })).toThrow(/versión/);
  });
});
