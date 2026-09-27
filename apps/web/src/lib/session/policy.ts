/**
 * Reglas de vigencia de la sesión, como funciones puras para poder probarlas con un reloj falso.
 *   - Inactividad: 15 min sin actividad cierran la sesión (aviso 60 s antes en la interfaz).
 *   - Absoluta: 12 h desde el inicio de sesión, aunque haya actividad.
 *   - El access token (10 min) se renueva cuando le quedan menos de 60 s.
 */
export interface SessionTimes {
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  accessExpiresAt: number;
}

export interface SessionPolicy {
  idleMs: number;
}

export type SessionState = 'active' | 'idle-expired' | 'absolute-expired';

export function sessionState(s: SessionTimes, now: number, policy: SessionPolicy): SessionState {
  if (now >= s.absoluteExpiresAt) return 'absolute-expired';
  if (now - s.lastSeenAt >= policy.idleMs) return 'idle-expired';
  return 'active';
}

export const REFRESH_MARGIN_MS = 60_000;
/** Escribir lastSeenAt en cada request sería caro; basta con hacerlo una vez por minuto. */
export const TOUCH_INTERVAL_MS = 60_000;

export function needsRefresh(s: SessionTimes, now: number): boolean {
  return s.accessExpiresAt - now < REFRESH_MARGIN_MS;
}

export function shouldTouch(s: SessionTimes, now: number): boolean {
  return now - s.lastSeenAt >= TOUCH_INTERVAL_MS;
}

/** Momento en que la sesión vencerá por inactividad (o antes, por la regla absoluta). */
export function idleExpiresAt(s: SessionTimes, policy: SessionPolicy): number {
  return Math.min(s.lastSeenAt + policy.idleMs, s.absoluteExpiresAt);
}

/** Solo rutas internas: evita redirecciones abiertas tras el login (?returnTo=https://otro-sitio). */
export function safeReturnTo(value: string | null | undefined, fallback = '/inicio'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
