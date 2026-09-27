import { describe, expect, it, vi } from 'vitest';
import { cognitoEndpoints, exchangeCode, needsRefresh, refreshTokens, revokeToken, TokenError } from './tokens';
import { shouldLockOnResume } from './lock-policy';
import { toBase64Url } from './base64url';

const now = () => 1_000_000;
const endpoints = cognitoEndpoints('https://ambar-dev-abc.auth.us-east-1.amazoncognito.com/');

describe('tokens de la app (cliente público con PKCE)', () => {
  it('canjea el código con el verifier y sin secreto de cliente', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 600 }));
    const set = await exchangeCode(
      { tokenEndpoint: endpoints.tokenEndpoint, clientId: 'mobile', code: 'c', redirectUri: 'ambar://auth/callback', codeVerifier: 'v' },
      fetchMock as unknown as typeof fetch,
      now,
    );
    expect(set).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1_600_000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ambar-dev-abc.auth.us-east-1.amazoncognito.com/oauth2/token');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('code_verifier')).toBe('v');
    expect(body.has('client_secret')).toBe(false);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('al refrescar conserva el refresh token si Cognito no rota', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'at2', expires_in: 600 }));
    const set = await refreshTokens({ tokenEndpoint: endpoints.tokenEndpoint, clientId: 'mobile', refreshToken: 'rt' }, fetchMock as unknown as typeof fetch, now);
    expect(set.refreshToken).toBe('rt');
  });

  it('un refresh revocado lanza TokenError con el error OAuth', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(refreshTokens({ tokenEndpoint: 'x', clientId: 'm', refreshToken: 'r' }, fetchMock as unknown as typeof fetch)).rejects.toMatchObject({
      oauthError: 'invalid_grant',
    });
    await expect(refreshTokens({ tokenEndpoint: 'x', clientId: 'm', refreshToken: 'r' }, fetchMock as unknown as typeof fetch)).rejects.toBeInstanceOf(TokenError);
  });

  it('revocar no lanza aunque no haya red', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await revokeToken({ revocationEndpoint: endpoints.revocationEndpoint, clientId: 'm', token: 't' }, fetchMock as unknown as typeof fetch)).toBe(false);
  });

  it('renueva cuando falta menos de un minuto', () => {
    expect(needsRefresh({ accessToken: 'a', refreshToken: null, expiresAt: 1_100_000 }, 1_000_000)).toBe(false);
    expect(needsRefresh({ accessToken: 'a', refreshToken: null, expiresAt: 1_050_000 }, 1_000_000)).toBe(true);
  });
});

describe('bloqueo y codificación', () => {
  it('bloquea tras 2 minutos en segundo plano', () => {
    expect(shouldLockOnResume(null, 10_000_000)).toBe(false);
    expect(shouldLockOnResume(1_000_000, 1_000_000 + 119_000)).toBe(false);
    expect(shouldLockOnResume(1_000_000, 1_000_000 + 120_000)).toBe(true);
  });

  it('convierte base64 estándar a base64url sin relleno', () => {
    expect(toBase64Url('ab+c/d==')).toBe('ab-c_d');
  });
});

import { jwtSubject } from './jwt';

describe('jwtSubject', () => {
  it('lee el sub de un JWT base64url (los sub de Cognito son UUID ASCII)', () => {
    const payload = Buffer.from(JSON.stringify({ sub: '5f3c9a1e-1111-4a5b-9c0d-ab12cd34ef56', note: '?>~' })).toString('base64url');
    expect(jwtSubject(`h.${payload}.s`)).toBe('5f3c9a1e-1111-4a5b-9c0d-ab12cd34ef56');
    expect(jwtSubject('basura')).toBeNull();
    expect(jwtSubject('a.%%%.c')).toBeNull();
  });
});
