import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, exchangeCode, validateIdToken } from '@/lib/auth/oidc';
import { config } from '@/lib/config';
import { unseal } from '@/lib/crypto';
import { createSession } from '@/lib/session/session';
import { OAUTH_COOKIE, type OAuthTransaction } from '@/lib/auth/transaction';

export const dynamic = 'force-dynamic';

const MAX_TX_AGE_MS = 10 * 60_000;

function fail(reason: string) {
  const res = NextResponse.redirect(new URL(`/entrar?motivo=${reason}`, config().origin));
  res.cookies.delete({ name: OAUTH_COOKIE, path: '/api/auth' });
  return res;
}

export async function GET(req: NextRequest) {
  const c = config();
  const params = req.nextUrl.searchParams;
  if (params.get('error')) return fail('rechazado');

  const sealed = req.cookies.get(OAUTH_COOKIE)?.value;
  const tx = sealed ? unseal<OAuthTransaction>(sealed, c.SESSION_SECRET) : null;
  // state inválido = posible login CSRF o una pestaña vieja: se descarta sin canjear el código.
  if (!tx || tx.state !== params.get('state') || Date.now() - tx.createdAt > MAX_TX_AGE_MS) return fail('intento');

  const code = params.get('code');
  if (!code) return fail('intento');

  try {
    const tokens = await exchangeCode(c, code, tx.verifier);
    if (!tokens.idToken) throw new AuthError('Cognito no devolvió ID token.');
    const identity = validateIdToken(c, tokens.idToken, tx.nonce);
    await createSession(identity, 'cognito', tokens);
  } catch (err) {
    console.error('Falló el callback de login:', err instanceof Error ? err.message : err);
    return fail('error');
  }

  const res = NextResponse.redirect(new URL(tx.returnTo, c.origin));
  res.cookies.delete({ name: OAUTH_COOKIE, path: '/api/auth' });
  return res;
}
