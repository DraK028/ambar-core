import { describe, expect, it } from 'vitest';
import { needsAction, REASON_TEXT, routeFor, unreadBadge } from './alerts';

const caseId = '5f0d7c7e-3a52-4b8e-9d57-3f2b1a9c0e11';

describe('avisos', () => {
  it('un FRAUD_CHECK lleva a la pantalla del caso', () => {
    expect(routeFor({ kind: 'FRAUD_CHECK', fraud_case_id: caseId })).toEqual({ pathname: '/caso/[id]', params: { id: caseId } });
  });

  it('un id que no es UUID (payload de push manipulado) lleva a la bandeja', () => {
    expect(routeFor({ kind: 'FRAUD_CHECK', fraud_case_id: '../../ajustes' })).toEqual({ pathname: '/avisos' });
    expect(routeFor({ kind: 'TRANSFER_SENT' })).toEqual({ pathname: '/avisos' });
    expect(routeFor(undefined)).toEqual({ pathname: '/avisos' });
  });

  it('solo un FRAUD_CHECK sin leer pide acción', () => {
    expect(needsAction({ kind: 'FRAUD_CHECK', read_at: null })).toBe(true);
    expect(needsAction({ kind: 'FRAUD_CHECK', read_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(needsAction({ kind: 'WELCOME', read_at: null })).toBe(false);
  });

  it('insignia de no leídos', () => {
    expect(unreadBadge(0)).toBeUndefined();
    expect(unreadBadge(3)).toBe('3');
    expect(unreadBadge(12)).toBe('9+');
  });

  it('cada motivo de riesgo tiene texto para el cliente', () => {
    expect(Object.keys(REASON_TEXT).sort()).toEqual(['HIGH_VELOCITY', 'NEW_BENEFICIARY', 'NIGHT_TIME', 'UNUSUAL_AMOUNT']);
  });
});
