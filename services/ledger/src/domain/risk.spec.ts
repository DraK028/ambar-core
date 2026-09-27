import { assessTransferRisk, localHour, RiskFacts } from './risk';

// 12:00 en CDMX (UTC-6, sin horario de verano desde 2022).
const noon = new Date('2026-09-15T18:00:00Z');
const base: RiskFacts = { amount: 50_000, knownBeneficiary: true, averageAmount: 40_000, recentTransfers: 0, at: noon };

describe('riesgo de transferencia', () => {
  it('una transferencia habitual tiene riesgo 0', () => {
    expect(assessTransferRisk(base)).toEqual({ score: 0, reasons: [] });
  });

  it('beneficiario nuevo suma 35', () => {
    expect(assessTransferRisk({ ...base, knownBeneficiary: false })).toEqual({ score: 35, reasons: ['NEW_BENEFICIARY'] });
  });

  it('monto de 3× el promedio es inusual; 2.99× no', () => {
    expect(assessTransferRisk({ ...base, amount: 120_000 }).reasons).toEqual(['UNUSUAL_AMOUNT']);
    expect(assessTransferRisk({ ...base, amount: 119_999 }).reasons).toEqual([]);
  });

  it('sin historial, el monto es inusual desde $10,000', () => {
    expect(assessTransferRisk({ ...base, averageAmount: null, amount: 999_999 }).reasons).toEqual([]);
    expect(assessTransferRisk({ ...base, averageAmount: null, amount: 1_000_000 }).reasons).toEqual(['UNUSUAL_AMOUNT']);
  });

  it('de 00:00 a 04:59 en CDMX es horario nocturno', () => {
    expect(localHour(new Date('2026-09-15T06:00:00Z'))).toBe(0);
    expect(assessTransferRisk({ ...base, at: new Date('2026-09-15T10:59:00Z') }).reasons).toEqual(['NIGHT_TIME']);
    expect(assessTransferRisk({ ...base, at: new Date('2026-09-15T11:00:00Z') }).reasons).toEqual([]);
  });

  it('3 transferencias en 10 minutos es velocidad alta', () => {
    expect(assessTransferRisk({ ...base, recentTransfers: 2 }).reasons).toEqual([]);
    expect(assessTransferRisk({ ...base, recentTransfers: 3 }).reasons).toEqual(['HIGH_VELOCITY']);
  });

  it('las señales se acumulan y el puntaje no pasa de 100', () => {
    const r = assessTransferRisk({
      amount: 2_000_000,
      knownBeneficiary: false,
      averageAmount: null,
      recentTransfers: 5,
      at: new Date('2026-09-15T08:00:00Z'),
    });
    expect(r.reasons).toEqual(['NEW_BENEFICIARY', 'UNUSUAL_AMOUNT', 'NIGHT_TIME', 'HIGH_VELOCITY']);
    expect(r.score).toBe(100);
  });
});
