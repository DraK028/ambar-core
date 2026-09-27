import { describe, expect, it } from 'vitest';
import { idleExpiresAt, needsRefresh, safeReturnTo, sessionState, shouldTouch } from './policy';

const MIN = 60_000;
const policy = { idleMs: 15 * MIN };
const t0 = Date.UTC(2026, 8, 26, 15, 0, 0);
const base = { createdAt: t0, lastSeenAt: t0, absoluteExpiresAt: t0 + 12 * 60 * MIN, accessExpiresAt: t0 + 10 * MIN };

describe('vigencia de la sesión', () => {
  it('sigue activa antes de 15 minutos sin actividad', () => {
    expect(sessionState(base, t0 + 14 * MIN, policy)).toBe('active');
  });

  it('vence por inactividad a los 15 minutos', () => {
    expect(sessionState(base, t0 + 15 * MIN, policy)).toBe('idle-expired');
  });

  it('vence a las 12 horas aunque haya actividad constante', () => {
    const busy = { ...base, lastSeenAt: t0 + 12 * 60 * MIN - 1 };
    expect(sessionState(busy, t0 + 12 * 60 * MIN, policy)).toBe('absolute-expired');
  });

  it('el aviso de inactividad nunca promete más allá del límite absoluto', () => {
    const late = { ...base, lastSeenAt: base.absoluteExpiresAt - 5 * MIN };
    expect(idleExpiresAt(late, policy)).toBe(base.absoluteExpiresAt);
    expect(idleExpiresAt(base, policy)).toBe(t0 + 15 * MIN);
  });

  it('renueva el access token cuando le queda menos de un minuto', () => {
    expect(needsRefresh(base, t0 + 8 * MIN)).toBe(false);
    expect(needsRefresh(base, t0 + 9 * MIN + 1)).toBe(true);
  });

  it('marca actividad como máximo una vez por minuto', () => {
    expect(shouldTouch(base, t0 + 30_000)).toBe(false);
    expect(shouldTouch(base, t0 + MIN)).toBe(true);
  });
});

describe('returnTo seguro', () => {
  it.each([
    ['/cuentas/abc', '/cuentas/abc'],
    ['/transferir?de=1', '/transferir?de=1'],
    [null, '/inicio'],
    ['https://malicioso.example', '/inicio'],
    ['//malicioso.example', '/inicio'],
    ['/\\malicioso.example', '/inicio'],
    ['javascript:alert(1)', '/inicio'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
