import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** Health check del ALB. Falla si la configuración es inválida, para que ECS no enrute tráfico. */
export function GET() {
  config();
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
