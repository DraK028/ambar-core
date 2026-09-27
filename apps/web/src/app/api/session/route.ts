import { NextResponse, type NextRequest } from 'next/server';
import { rejectCrossSite } from '@/lib/http';
import { getSession, keepAlive } from '@/lib/session/session';

export const dynamic = 'force-dynamic';

/** "Seguir conectado": extiende la sesión por inactividad. No extiende el límite absoluto. */
export async function POST(req: NextRequest) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const idleExpiresAt = await keepAlive();
  if (!idleExpiresAt) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ idleExpiresAt, now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Hora de vencimiento por inactividad, sin contar la consulta como actividad. */
export async function GET() {
  const session = await getSession({ touch: false });
  if (!session) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ idleExpiresAt: session.idleExpiresAt, now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
