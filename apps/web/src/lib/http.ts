import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { config } from './config';

/**
 * Los Route Handlers que cambian estado (login local, logout, keepalive) solo aceptan
 * solicitudes de nuestro propio origen. Complementa SameSite=Strict en la cookie.
 */
export function rejectCrossSite(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  if (origin) {
    return origin === config().origin ? null : forbidden();
  }
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin' ? null : forbidden();
}

function forbidden(): NextResponse {
  return NextResponse.json(
    { type: 'about:blank', title: 'Sin permiso', status: 403, code: 'FORBIDDEN', detail: 'Origen no permitido.' },
    { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

/** 303 See Other: tras un POST, el navegador sigue con GET. */
export function seeOther(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, config().origin), 303);
}
