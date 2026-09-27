import { loadConfig, loadDbConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://localhost/ambar',
  LOCAL_JWT_SECRET: 'x'.repeat(32),
};

const cognito = {
  AUTH_MODE: 'cognito',
  COGNITO_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc',
};

const aws = {
  DB_AUTH: 'iam',
  DB_HOST: 'ambar-dev-ledger.cluster-xyz.us-east-1.rds.amazonaws.com',
  DB_USER: 'ambar_app',
  AWS_REGION: 'us-east-1',
  DB_SSL_CA_FILE: '/app/certs/rds-global-bundle.pem',
};

describe('configuración', () => {
  it('usa valores por defecto seguros', () => {
    const c = loadConfig(base);
    expect(c.APP_ENV).toBe('local');
    expect(c.AUTH_MODE).toBe('local');
    expect(c.DB_AUTH).toBe('url');
    expect(c.ENABLE_QA_ENDPOINTS).toBe(false);
    expect(c.ADMIN_GROUP).toBe('operators');
    expect(c.PORT).toBe(3000);
  });

  it('exige un secreto largo en modo local', () => {
    expect(() => loadConfig({ ...base, LOCAL_JWT_SECRET: 'corto' })).toThrow(/LOCAL_JWT_SECRET/);
  });

  it('exige el issuer en modo cognito', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'cognito' })).toThrow(/COGNITO_ISSUER/);
  });

  it('fuera de local prohíbe la autenticación local', () => {
    for (const APP_ENV of ['dev', 'staging', 'prod']) {
      expect(() => loadConfig({ ...base, APP_ENV })).toThrow(/AUTH_MODE/);
    }
  });

  it('en producción prohíbe los endpoints de QA, pero no en dev', () => {
    expect(() => loadConfig({ ...cognito, ...aws, APP_ENV: 'prod', ENABLE_QA_ENDPOINTS: 'true' })).toThrow(/ENABLE_QA_ENDPOINTS/);
    expect(loadConfig({ ...cognito, ...aws, APP_ENV: 'dev', ENABLE_QA_ENDPOINTS: 'true' }).ENABLE_QA_ENDPOINTS).toBe(true);
  });

  it('acepta la configuración de ECS: Cognito y Aurora con IAM y TLS', () => {
    const c = loadConfig({ ...cognito, ...aws, APP_ENV: 'prod', NODE_ENV: 'production' });
    expect(c.DB_AUTH).toBe('iam');
    expect(c.DB_PORT).toBe(5432);
    expect(c.DB_NAME).toBe('ambar');
  });

  it('fuera de local exige TLS verificado hacia la base', () => {
    const { DB_SSL_CA_FILE: _omit, ...noTls } = aws;
    expect(() => loadConfig({ ...cognito, ...noTls, APP_ENV: 'dev' })).toThrow(/DB_SSL_CA_FILE/);
  });

  it('valida los datos de conexión de cada modo', () => {
    expect(() => loadDbConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadDbConfig({ DB_AUTH: 'password', DB_HOST: 'h', DB_USER: 'u' })).toThrow(/DB_PASSWORD/);
    expect(() => loadDbConfig({ DB_AUTH: 'iam', DB_HOST: 'h', DB_USER: 'u' })).toThrow(/AWS_REGION/);
    expect(loadDbConfig({ DB_AUTH: 'password', DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p' }).DB_AUTH).toBe('password');
  });
});
