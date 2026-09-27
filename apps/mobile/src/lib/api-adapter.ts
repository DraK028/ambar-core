import type { AmbarClient, Problem } from '@ambar/api-client';
import type { ApiResult, TransferApi } from './transfer-flow';

type Raw<T> = { data?: T; error?: unknown; response: Response };

export function toResult<T>(raw: Raw<T>): ApiResult<T> {
  if (raw.data !== undefined && raw.response.ok) return { ok: true, data: raw.data };
  return { ok: false, status: raw.response.status, problem: (raw.error ?? {}) as Partial<Problem> };
}

/** Un error de red no es un error del core: se reporta con status 0 para decir "reintenta". */
export async function guarded<T>(call: () => Promise<Raw<T>>): Promise<ApiResult<T>> {
  try {
    return toResult(await call());
  } catch {
    return { ok: false, status: 0, problem: { code: 'NETWORK' } };
  }
}

/** Adaptador del cliente tipado (generado del contrato) a lo que necesita el flujo. */
export function transferApi(client: AmbarClient): TransferApi {
  return {
    createTransfer: (op, idempotencyKey, stepUpProof) =>
      guarded(() =>
        client.POST('/v1/transfers', {
          params: { header: { 'Idempotency-Key': idempotencyKey, ...(stepUpProof ? { 'X-Step-Up': stepUpProof } : {}) } },
          body: op,
        }),
      ),
    createChallenge: (deviceId, operation) =>
      guarded(() => client.POST('/v1/step-up/challenges', { body: { device_id: deviceId, operation } })),
  };
}
