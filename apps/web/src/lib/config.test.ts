import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

const secret = 'x'.repeat(40);

describe('configuración de la banca web', () => {
  it('en local funciona con el proveedor local y sesiones en memoria', () => {
    const c = parseConfig({ SESSION_SECRET: secret, LOCAL_JWT_SECRET: secret });
    expect(c.AUTH_PROVIDER).toBe('local');
    expect(c.secureCookies).toBe(false);
    expect(c.origin).toBe('http://localhost:3001');
  });

  it('fuera de local exige Cognito, DynamoDB y HTTPS', () => {
    let err = '';
    try {
      parseConfig({ APP_ENV: 'dev', SESSION_SECRET: secret, LOCAL_JWT_SECRET: secret, APP_URL: 'http://web.example' });
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err).toMatch(/AUTH_PROVIDER/);
    expect(err).toMatch(/SESSION_STORE/);
    expect(err).toMatch(/APP_URL/);
  });

  it('acepta la configuración de AWS', () => {
    const c = parseConfig({
      APP_ENV: 'dev',
      APP_URL: 'https://d111.cloudfront.net',
      AUTH_PROVIDER: 'cognito',
      COGNITO_DOMAIN: 'https://x.auth.us-east-1.amazoncognito.com',
      COGNITO_CLIENT_ID: 'id',
      COGNITO_CLIENT_SECRET: 'secret',
      COGNITO_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x',
      SESSION_SECRET: secret,
      SESSION_STORE: 'dynamodb',
      SESSIONS_TABLE: 'ambar-dev-web-sessions',
      AWS_REGION: 'us-east-1',
    });
    expect(c.secureCookies).toBe(true);
  });

  it('exige un secreto de sesión largo', () => {
    expect(() => parseConfig({ SESSION_SECRET: 'corto', LOCAL_JWT_SECRET: secret })).toThrow(/SESSION_SECRET/);
  });
});
