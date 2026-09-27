import { NextResponse, type NextRequest } from 'next/server';
import { authorizeUrl } from '@/lib/auth/oidc';
import { OAUTH_COOKIE, type OAuthTransaction } from '@/lib/auth/transaction';
import { config } from '@/lib/config';
import { pkcePair, randomToken, seal } from '@/lib/crypto';
import { safeReturnTo } from '@/lib/session/policy';

export const dynamic = 'force-dynamic';

/** Inicia Authorization Code + PKCE. El verifier, state y nonce viajan cifrados en una cookie corta. */
export async function GET(req: NextRequest) {
  const c = config();
  if (c.AUTH_PROVIDER !== 'cognito') {
    return NextResponse.redirect(new URL('/entrar', c.origin));
  }
  const { verifier, challenge } = pkcePair();
  const tx: OAuthTransaction = {
    state: randomToken(16),
    nonce: randomToken(16),
    verifier,
    returnTo: safeReturnTo(req.nextUrl.searchParams.get('returnTo')),
    createdAt: Date.now(),
  };
  const res = NextResponse.redirect(authorizeUrl(c, { state: tx.state, nonce: tx.nonce, codeChallenge: challenge }));
  res.cookies.set(OAUTH_COOKIE, seal(tx, c.SESSION_SECRET), {
    httpOnly: true,
    secure: c.secureCookies,
    // Lax (no Strict): la cookie debe viajar en la navegación de regreso desde el dominio de Cognito.
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 600,
  });
  return res;
}
