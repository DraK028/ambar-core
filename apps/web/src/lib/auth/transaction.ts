/** Cookie de la transacción OAuth (Authorization Code + PKCE), cifrada con SESSION_SECRET. */
export const OAUTH_COOKIE = 'ambar_oauth';

export interface OAuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  createdAt: number;
}
