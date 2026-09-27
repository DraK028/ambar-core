/** Tras 2 minutos en segundo plano la app se bloquea y pide biometría otra vez. */
export const BACKGROUND_LOCK_MS = 2 * 60_000;

export function shouldLockOnResume(backgroundedAt: number | null, now: number, limit = BACKGROUND_LOCK_MS): boolean {
  return backgroundedAt !== null && now - backgroundedAt >= limit;
}
