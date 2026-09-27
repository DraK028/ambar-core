/**
 * Puntaje de riesgo de una transferencia (0–100). Es deliberadamente simple y explicable:
 * cada señal suma puntos y queda registrada como motivo, para que el cliente y el equipo
 * de fraude vean por qué se levantó una alerta. No bloquea la operación: el core publica
 * el puntaje en el evento y n8n decide si abre un caso.
 */
export type RiskReason = 'NEW_BENEFICIARY' | 'UNUSUAL_AMOUNT' | 'NIGHT_TIME' | 'HIGH_VELOCITY';

export interface RiskFacts {
  amount: number;
  /** ¿El usuario ya había transferido antes a esta cuenta? */
  knownBeneficiary: boolean;
  /** Monto promedio de sus transferencias de los últimos 90 días (null si no hay historial). */
  averageAmount: number | null;
  /** Transferencias del mismo usuario en los 10 minutos anteriores. */
  recentTransfers: number;
  at: Date;
}

export interface RiskAssessment {
  score: number;
  reasons: RiskReason[];
}

export const RISK_POINTS: Record<RiskReason, number> = {
  NEW_BENEFICIARY: 35,
  UNUSUAL_AMOUNT: 30,
  NIGHT_TIME: 15,
  HIGH_VELOCITY: 30,
};

/** Sin historial, un monto se considera inusual desde $10,000.00. */
export const FIRST_TRANSFER_UNUSUAL_AMOUNT = 1_000_000;
export const UNUSUAL_AMOUNT_FACTOR = 3;
export const VELOCITY_LIMIT = 3;
/** Puntaje desde el cual n8n abre un caso de fraude (el flujo lo usa como default). */
export const FRAUD_CASE_THRESHOLD = 60;

const hourInMexicoCity = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City',
  hour: 'numeric',
  hourCycle: 'h23',
});

export function localHour(at: Date): number {
  return Number(hourInMexicoCity.format(at));
}

export function assessTransferRisk(f: RiskFacts): RiskAssessment {
  const reasons: RiskReason[] = [];
  if (!f.knownBeneficiary) reasons.push('NEW_BENEFICIARY');

  const unusual =
    f.averageAmount === null || f.averageAmount <= 0
      ? f.amount >= FIRST_TRANSFER_UNUSUAL_AMOUNT
      : f.amount >= f.averageAmount * UNUSUAL_AMOUNT_FACTOR;
  if (unusual) reasons.push('UNUSUAL_AMOUNT');

  if (localHour(f.at) < 5) reasons.push('NIGHT_TIME');
  if (f.recentTransfers >= VELOCITY_LIMIT) reasons.push('HIGH_VELOCITY');

  const score = Math.min(100, reasons.reduce((sum, r) => sum + RISK_POINTS[r], 0));
  return { score, reasons };
}
