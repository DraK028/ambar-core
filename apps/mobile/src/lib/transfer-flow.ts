import { formatMXN, lastFour } from '@ambar/banking-rules';
import type { Problem, StepUpChallenge, Transfer, TransferOperation } from '@ambar/api-client';
import { toBase64Url } from './base64url';
import { messageFor } from './problems';

/**
 * Orquestación de una transferencia desde la app, sin React ni módulos nativos
 * (se prueba con dobles). Si el core responde STEP_UP_REQUIRED (RFC 9470):
 *   1. pide un reto ligado a esta operación,
 *   2. lo firma la llave del dispositivo tras la biometría,
 *   3. repite la transferencia con X-Step-Up y la MISMA Idempotency-Key.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; problem: Partial<Problem> };

export interface TransferApi {
  createTransfer(op: Omit<TransferOperation, 'type'>, idempotencyKey: string, stepUpProof?: string): Promise<ApiResult<Transfer>>;
  createChallenge(deviceId: string, op: TransferOperation): Promise<ApiResult<StepUpChallenge>>;
}

export interface Signer {
  /** Devuelve la firma DER en base64 (formato del módulo nativo). Rechaza con error.code. */
  sign(payload: string, prompt: { title: string; subtitle: string; cancel: string }): Promise<string>;
}

export type Field = 'clabe' | 'amount' | 'concept' | 'source';

export type TransferOutcome =
  | { status: 'done'; transfer: Transfer; confirmedWithDevice: boolean }
  | { status: 'needs-device'; message: string }
  | { status: 'cancelled' }
  | { status: 'device-invalidated'; message: string }
  | { status: 'error'; code: string; message: string; field?: Field };

const FIELD_BY_CODE: Record<string, Field> = { NOT_FOUND: 'clabe', SAME_ACCOUNT: 'clabe', INSUFFICIENT_FUNDS: 'amount' };

function failure(result: Extract<ApiResult<unknown>, { ok: false }>): TransferOutcome {
  const code = result.problem.code ?? (result.status === 0 ? 'NETWORK' : `HTTP_${result.status}`);
  return { status: 'error', code, message: messageFor(code), field: FIELD_BY_CODE[code] };
}

export async function submitTransfer(
  deps: { api: TransferApi; signer: Signer; deviceId: string | null },
  op: Omit<TransferOperation, 'type'>,
  idempotencyKey: string,
): Promise<TransferOutcome> {
  const first = await deps.api.createTransfer(op, idempotencyKey);
  if (first.ok) return { status: 'done', transfer: first.data, confirmedWithDevice: false };
  if (first.problem.code !== 'STEP_UP_REQUIRED') return failure(first);

  if (!deps.deviceId) {
    const reason = first.problem.step_up?.reason;
    return {
      status: 'needs-device',
      message:
        reason === 'NEW_BENEFICIARY'
          ? 'Para transferir a una cuenta nueva necesitas activar la biometría en este teléfono.'
          : `Para transferir ${formatMXN(op.amount)} o más necesitas activar la biometría en este teléfono.`,
    };
  }

  const challenge = await deps.api.createChallenge(deps.deviceId, { type: 'transfer', ...op });
  if (!challenge.ok) {
    if (challenge.status === 404) return { status: 'device-invalidated', message: 'Este teléfono ya no está registrado. Vuelve a activar la biometría.' };
    return failure(challenge);
  }

  let signature: string;
  try {
    signature = await deps.signer.sign(challenge.data.signing_payload, {
      title: 'Confirma tu transferencia',
      subtitle: `${formatMXN(op.amount)} a la CLABE ••${lastFour(op.destination_clabe)}`,
      cancel: 'Cancelar',
    });
  } catch (err) {
    const code = String((err as { code?: string }).code ?? '');
    if (code.includes('CANCELLED')) return { status: 'cancelled' };
    if (code.includes('KEY_INVALIDATED') || code.includes('NO_KEY')) {
      return { status: 'device-invalidated', message: 'La biometría de tu teléfono cambió. Por seguridad, vuelve a activarla.' };
    }
    if (code.includes('LOCKOUT')) return { status: 'error', code: 'LOCKOUT', message: 'Demasiados intentos. Desbloquea tu teléfono con el código e intenta de nuevo.' };
    return { status: 'error', code: 'SIGN_FAILED', message: 'No se pudo confirmar con la biometría. Intenta de nuevo.' };
  }

  const second = await deps.api.createTransfer(op, idempotencyKey, `${challenge.data.id}.${toBase64Url(signature)}`);
  if (second.ok) return { status: 'done', transfer: second.data, confirmedWithDevice: true };
  return failure(second);
}
