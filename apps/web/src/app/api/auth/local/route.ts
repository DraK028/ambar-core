import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { mintLocalToken } from '@/lib/auth/oidc';
import { config } from '@/lib/config';
import { rejectCrossSite, seeOther } from '@/lib/http';
import { createSession } from '@/lib/session/session';

export const dynamic = 'force-dynamic';

const USER = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Login de desarrollo sin Cognito. La configuración impide habilitarlo fuera de APP_ENV=local. */
export async function POST(req: NextRequest) {
  const c = config();
  if (c.AUTH_PROVIDER !== 'local' || c.APP_ENV !== 'local') {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;

  const form = await req.formData();
  const user = String(form.get('user') ?? '').trim().toLowerCase();
  if (!USER.test(user)) return seeOther('/entrar?motivo=usuario');

  const tokens = await mintLocalToken(c, user);
  await createSession({ sub: user, email: `${user}@demo.ambar.local` }, 'local', tokens);
  return seeOther('/inicio');
}
