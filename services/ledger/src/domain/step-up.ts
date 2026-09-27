import type { StepUpReason } from './errors';

/**
 * Política de confirmación reforzada (step-up) para transferencias desde la app móvil:
 * se exige firma biométrica del dispositivo si el monto alcanza el umbral o si el
 * usuario nunca antes había transferido a esa cuenta (defensa típica contra robo de sesión:
 * el atacante suele mandar dinero a una cuenta nueva).
 */
export function stepUpReason(p: { amount: number; threshold: number; knownBeneficiary: boolean }): StepUpReason | null {
  if (p.amount >= p.threshold) return 'AMOUNT_THRESHOLD';
  if (!p.knownBeneficiary) return 'NEW_BENEFICIARY';
  return null;
}

export const STEP_UP_PAYLOAD_VERSION = 'ambar-step-up:v1';
export const CHALLENGE_TTL_MS = 60_000;

/**
 * Texto exacto que firma el dispositivo. Incluye el id y el nonce del reto (un solo uso)
 * y el hash de la operación (la firma no sirve para otro monto ni otro destino).
 */
export function signingPayload(challengeId: string, nonce: string, operationHash: string): string {
  return `${STEP_UP_PAYLOAD_VERSION}\n${challengeId}\n${nonce}\n${operationHash}`;
}

/** Header X-Step-Up: "<challenge_id>.<firma en base64url>". */
export function parseStepUpProof(value: string): { challengeId: string; signature: Buffer } | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,200})$/.exec(value);
  if (!match) return null;
  return { challengeId: match[1], signature: Buffer.from(match[2], 'base64url') };
}
