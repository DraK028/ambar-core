import 'server-only';
import { SignJWT } from 'jose';
import type { WebConfig } from '../config';

/**
 * Cliente OIDC mínimo para el cliente confidencial `web` de Cognito.
 * Todo ocurre en el servidor: el navegador solo ve el redirect al login y la cookie de sesión.
 */

export const CUSTOMER_SCOPES = [
  'openid',
  'email',
  'ambar-api/accounts.read',
  'ambar-api/accounts.write',
  'ambar-api/transfers.write',
  'ambar-api/assistant.chat',
];

export interface TokenSet {
  accessToken: string;
  expiresIn: number;
  refreshToken: string | null;
  idToken: string | null;
}

export interface Identity {
  sub: string;
  email: string | null;
}

export class AuthError extends Error {}

export function redirectUri(c: WebConfig): string {
  return `${c.origin}/api/auth/callback`;
}

export function authorizeUrl(c: WebConfig, p: { state: string; nonce: string; codeChallenge: string }): string {
  const url = new URL(`${c.COGNITO_DOMAIN}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: c.COGNITO_CLIENT_ID!,
    redirect_uri: redirectUri(c),
    scope: CUSTOMER_SCOPES.join(' '),
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export function logoutUrl(c: WebConfig): string {
  const url = new URL(`${c.COGNITO_DOMAIN}/logout`);
  url.search = new URLSearchParams({ client_id: c.COGNITO_CLIENT_ID!, logout_uri: `${c.origin}/entrar` }).toString();
  return url.toString();
}

function basicAuth(c: WebConfig): string {
  return `Basic ${Buffer.from(`${c.COGNITO_CLIENT_ID}:${c.COGNITO_CLIENT_SECRET}`).toString('base64')}`;
}

async function tokenRequest(c: WebConfig, body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenSet> {
  const res = await fetchImpl(`${c.COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(c) },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new AuthError(`Cognito rechazó la solicitud de token (${res.status} ${String(json.error ?? '')}).`);
  }
  return {
    accessToken: json.access_token,
    expiresIn: Number(json.expires_in ?? 600),
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    idToken: typeof json.id_token === 'string' ? json.id_token : null,
  };
}

export function exchangeCode(c: WebConfig, code: string, verifier: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(
    c,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri(c), code_verifier: verifier, client_id: c.COGNITO_CLIENT_ID! },
    fetchImpl,
  );
}

export function refreshTokens(c: WebConfig, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(c, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.COGNITO_CLIENT_ID! }, fetchImpl);
}

/** Revoca el refresh token (y los access tokens emitidos con él) al cerrar sesión. */
export async function revokeRefreshToken(c: WebConfig, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(`${c.COGNITO_DOMAIN}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(c) },
    body: new URLSearchParams({ token: refreshToken }),
    cache: 'no-store',
  }).catch(() => undefined); // cerrar sesión localmente no debe depender de que Cognito responda
}

function decodePayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new AuthError('El ID token no tiene el formato esperado.');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * El ID token llegó por el canal directo servidor-a-servidor con TLS (no por el navegador),
 * así que OIDC Core §3.1.3.7 permite no verificar la firma. Sí se verifican emisor,
 * audiencia, tipo, vigencia y el nonce que liga el token a esta transacción de login.
 */
export function validateIdToken(c: WebConfig, idToken: string, expectedNonce: string, now = Date.now()): Identity {
  const claims = decodePayload(idToken);
  if (claims.iss !== c.COGNITO_ISSUER) throw new AuthError('El ID token viene de otro emisor.');
  if (claims.aud !== c.COGNITO_CLIENT_ID) throw new AuthError('El ID token es para otro cliente.');
  if (claims.token_use !== 'id') throw new AuthError('Se esperaba un ID token.');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new AuthError('El ID token expiró.');
  if (claims.nonce !== expectedNonce) throw new AuthError('El nonce del ID token no coincide.');
  if (typeof claims.sub !== 'string') throw new AuthError('El ID token no tiene sujeto.');
  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

/** Proveedor local: tokens con la misma forma que Cognito, firmados con el secreto del Ledger local. */
export async function mintLocalToken(c: WebConfig, sub: string, ttlSeconds = 600): Promise<TokenSet> {
  const accessToken = await new SignJWT({
    scope: CUSTOMER_SCOPES.filter((s) => s.startsWith('ambar-api/')).join(' '),
    token_use: 'access',
    client_id: 'ambar-local-web',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('ambar-local')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(c.LOCAL_JWT_SECRET!));
  return { accessToken, expiresIn: ttlSeconds, refreshToken: null, idToken: null };
}
