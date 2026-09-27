/**
 * Solicitudes de tokens sin estado, con `fetch` inyectable para probarlas sin red.
 * La app móvil es un cliente público de Cognito (sin secreto): PKCE protege el canje del código.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms en que vence el access token. */
  expiresAt: number;
}

export class TokenError extends Error {
  constructor(
    readonly status: number,
    readonly oauthError: string | undefined,
  ) {
    super(`Solicitud de token rechazada (${status}${oauthError ? ` ${oauthError}` : ''})`);
  }
}

type Fetch = typeof fetch;

async function post(url: string, body: Record<string, string>, fetchImpl: Fetch, now: () => number): Promise<TokenSet> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new TokenError(res.status, typeof json.error === 'string' ? json.error : undefined);
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: now() + Number(json.expires_in ?? 600) * 1000,
  };
}

export function cognitoEndpoints(domain: string) {
  const base = domain.replace(/\/$/, '');
  return {
    authorizationEndpoint: `${base}/oauth2/authorize`,
    tokenEndpoint: `${base}/oauth2/token`,
    revocationEndpoint: `${base}/oauth2/revoke`,
  };
}

export function exchangeCode(
  p: { tokenEndpoint: string; clientId: string; code: string; redirectUri: string; codeVerifier: string },
  fetchImpl: Fetch = fetch,
  now = Date.now,
) {
  return post(
    p.tokenEndpoint,
    { grant_type: 'authorization_code', client_id: p.clientId, code: p.code, redirect_uri: p.redirectUri, code_verifier: p.codeVerifier },
    fetchImpl,
    now,
  );
}

export async function refreshTokens(
  p: { tokenEndpoint: string; clientId: string; refreshToken: string },
  fetchImpl: Fetch = fetch,
  now = Date.now,
): Promise<TokenSet> {
  const set = await post(p.tokenEndpoint, { grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken }, fetchImpl, now);
  // Cognito no devuelve un refresh token nuevo salvo que esté activada la rotación: se conserva el actual.
  return { ...set, refreshToken: set.refreshToken ?? p.refreshToken };
}

/** Revocar al cerrar sesión; un fallo de red no impide cerrar la sesión en el teléfono. */
export async function revokeToken(p: { revocationEndpoint: string; clientId: string; token: string }, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(p.revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: p.clientId, token: p.token }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Modo local: tools/dev-auth-server.mjs emite tokens con la forma de Cognito (solo en tu máquina). */
export function devLogin(p: { devAuthUrl: string; sub: string }, fetchImpl: Fetch = fetch, now = Date.now) {
  return post(`${p.devAuthUrl}/token`, { grant_type: 'dev_login', sub: p.sub }, fetchImpl, now);
}

export function devRefresh(p: { devAuthUrl: string; refreshToken: string }, fetchImpl: Fetch = fetch, now = Date.now) {
  return post(`${p.devAuthUrl}/token`, { grant_type: 'refresh_token', refresh_token: p.refreshToken }, fetchImpl, now).then((s) => ({
    ...s,
    refreshToken: s.refreshToken ?? p.refreshToken,
  }));
}

export const REFRESH_MARGIN_MS = 60_000;

export function needsRefresh(tokens: TokenSet, now = Date.now()): boolean {
  return tokens.expiresAt - now < REFRESH_MARGIN_MS;
}
