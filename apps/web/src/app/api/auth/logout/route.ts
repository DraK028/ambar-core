import type { NextRequest } from 'next/server';
import { logoutUrl, revokeRefreshToken } from '@/lib/auth/oidc';
import { config } from '@/lib/config';
import { rejectCrossSite, seeOther } from '@/lib/http';
import { destroySession } from '@/lib/session/session';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Cierra la sesión aquí, revoca el refresh token en Cognito y cierra la sesión del dominio de Cognito. */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;

  const c = config();
  const ended = await destroySession();
  if (ended?.provider === 'cognito') {
    if (ended.refreshToken) await revokeRefreshToken(c, ended.refreshToken);
    return NextResponse.redirect(logoutUrl(c), 303);
  }
  return seeOther('/entrar?motivo=salida');
}
