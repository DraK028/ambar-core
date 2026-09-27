import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../config';
import { authorizeUrl, exchangeCode, logoutUrl, refreshTokens, revokeRefreshToken, validateIdToken } from './oidc';

const c = parseConfig({
  APP_URL: 'https://banca.ambar.example',
  AUTH_PROVIDER: 'cognito',
  COGNITO_DOMAIN: 'https://ambar-dev-abc.auth.us-east-1.amazoncognito.com',
  COGNITO_CLIENT_ID: 'web-client',
  COGNITO_CLIENT_SECRET: 'shh',
  COGNITO_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool',
  SESSION_SECRET: 'x'.repeat(40),
});

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.firma`;
const now = Date.UTC(2026, 8, 26, 15, 0, 0);
const good = {
  iss: c.COGNITO_ISSUER,
  aud: 'web-client',
  token_use: 'id',
  exp: now / 1000 + 600,
  nonce: 'n-123',
  sub: 'user-1',
  email: 'ana@example.com',
};

describe('authorize y logout', () => {
  it('pide code con PKCE S256, state, nonce y los scopes del cliente', () => {
    const url = new URL(authorizeUrl(c, { state: 's', nonce: 'n', codeChallenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://ambar-dev-abc.auth.us-east-1.amazoncognito.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'web-client',
      redirect_uri: 'https://banca.ambar.example/api/auth/callback',
      state: 's',
      nonce: 'n',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('scope')).toContain('ambar-api/transfers.write');
    expect(url.searchParams.get('scope')).not.toContain('ledger.admin');
  });

  it('el logout de Cognito regresa a /entrar', () => {
    expect(new URL(logoutUrl(c)).searchParams.get('logout_uri')).toBe('https://banca.ambar.example/entrar');
  });
});

describe('validación del ID token', () => {
  it('acepta un token correcto', () => {
    expect(validateIdToken(c, idToken(good), 'n-123', now)).toEqual({ sub: 'user-1', email: 'ana@example.com' });
  });

  it.each([
    ['otro emisor', { iss: 'https://evil.example' }, /emisor/],
    ['otra audiencia', { aud: 'otro-cliente' }, /cliente/],
    ['access token en lugar de ID', { token_use: 'access' }, /ID token/],
    ['vencido', { exp: now / 1000 - 1 }, /expiró/],
    ['nonce distinto (repetición)', { nonce: 'otro' }, /nonce/],
  ])('rechaza %s', (_name, override, message) => {
    expect(() => validateIdToken(c, idToken({ ...good, ...override }), 'n-123', now)).toThrow(message);
  });
});

describe('endpoint de tokens', () => {
  it('canjea el código con el verifier y autenticación básica del cliente', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'at', expires_in: 600, refresh_token: 'rt', id_token: 'it' }));
    const tokens = await exchangeCode(c, 'code-1', 'verifier-1', fetchMock as unknown as typeof fetch);
    expect(tokens).toEqual({ accessToken: 'at', expiresIn: 600, refreshToken: 'rt', idToken: 'it' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${c.COGNITO_DOMAIN}/oauth2/token`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('web-client:shh').toString('base64')}`);
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('verifier-1');
  });

  it('un error de Cognito se convierte en AuthError sin exponer el cuerpo', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(refreshTokens(c, 'rt', fetchMock as unknown as typeof fetch)).rejects.toThrow(/invalid_grant/);
  });

  it('revocar no lanza aunque Cognito no responda', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('red caída');
    });
    await expect(revokeRefreshToken(c, 'rt', fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
