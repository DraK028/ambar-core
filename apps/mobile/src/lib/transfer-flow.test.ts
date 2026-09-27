import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, Signer, TransferApi } from './transfer-flow';
import { submitTransfer } from './transfer-flow';

const op = { source_account_id: 'src', destination_clabe: '999180000000000015', amount: 750_000, concept: 'Enganche' };
const transfer = { id: 't-1', status: 'POSTED', source_account_id: 'src', destination_account_id: 'dst', amount: 750_000, currency: 'MXN', concept: 'Enganche', created_at: '2026-09-26T15:00:00Z' } as const;
const stepUp = (reason = 'AMOUNT_THRESHOLD'): ApiResult<never> => ({ ok: false, status: 401, problem: { code: 'STEP_UP_REQUIRED', step_up: { reason } } as never });

function fakes(results: Array<ApiResult<unknown>>, signer?: Partial<Signer>) {
  const api: TransferApi = {
    createTransfer: vi.fn(async () => results.shift() as never),
    createChallenge: vi.fn(async () => ({ ok: true, data: { id: '0b6c2f0e-6c47-4f5e-9b0e-2b9a4d1f7c11', expires_at: 'x', signing_payload: 'PAYLOAD' } }) as never),
  };
  const sign = vi.fn(signer?.sign ?? (async () => 'ab+c/d=='));
  return { api, signer: { sign } as Signer, sign };
}

describe('transferencia desde la app', () => {
  it('sin step-up: una sola llamada', async () => {
    const { api, signer } = fakes([{ ok: true, data: transfer }]);
    const out = await submitTransfer({ api, signer, deviceId: 'dev-1' }, op, 'key-1');
    expect(out).toEqual({ status: 'done', transfer, confirmedWithDevice: false });
    expect(api.createChallenge).not.toHaveBeenCalled();
  });

  it('con step-up: pide reto, firma con biometría y reintenta con la misma Idempotency-Key', async () => {
    const { api, signer, sign } = fakes([stepUp(), { ok: true, data: transfer }]);
    const out = await submitTransfer({ api, signer, deviceId: 'dev-1' }, op, 'key-1');

    expect(out).toMatchObject({ status: 'done', confirmedWithDevice: true });
    expect(api.createChallenge).toHaveBeenCalledWith('dev-1', { type: 'transfer', ...op });
    expect(sign).toHaveBeenCalledWith('PAYLOAD', expect.objectContaining({ subtitle: '$7,500.00 a la CLABE ••0015' }));
    // La firma se envía en base64url, sin relleno.
    expect(api.createTransfer).toHaveBeenLastCalledWith(op, 'key-1', '0b6c2f0e-6c47-4f5e-9b0e-2b9a4d1f7c11.ab-c_d');
  });

  it('sin dispositivo activado explica por qué hace falta', async () => {
    const { api, signer } = fakes([stepUp('NEW_BENEFICIARY')]);
    const out = await submitTransfer({ api, signer, deviceId: null }, op, 'k');
    expect(out).toMatchObject({ status: 'needs-device', message: expect.stringMatching(/cuenta nueva/) });
  });

  it('si el usuario cancela la biometría, no se reintenta', async () => {
    const { api, signer } = fakes([stepUp()], { sign: async () => Promise.reject(Object.assign(new Error('x'), { code: 'CANCELLED' })) });
    expect(await submitTransfer({ api, signer, deviceId: 'd' }, op, 'k')).toEqual({ status: 'cancelled' });
    expect(api.createTransfer).toHaveBeenCalledTimes(1);
  });

  it('si la biometría del teléfono cambió, pide volver a activar', async () => {
    const { api, signer } = fakes([stepUp()], { sign: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ERR_KEY_INVALIDATED' })) });
    expect(await submitTransfer({ api, signer, deviceId: 'd' }, op, 'k')).toMatchObject({ status: 'device-invalidated' });
  });

  it('un dispositivo revocado en el servidor (404 al pedir reto) también pide reactivar', async () => {
    const { api, signer } = fakes([stepUp()]);
    (api.createChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 404, problem: { code: 'NOT_FOUND' } });
    expect(await submitTransfer({ api, signer, deviceId: 'd' }, op, 'k')).toMatchObject({ status: 'device-invalidated' });
  });

  it('mapea errores del core al campo del formulario', async () => {
    const { api, signer } = fakes([{ ok: false, status: 422, problem: { code: 'INSUFFICIENT_FUNDS' } }]);
    expect(await submitTransfer({ api, signer, deviceId: 'd' }, op, 'k')).toMatchObject({ status: 'error', field: 'amount' });
  });

  it('un error de red se reporta como tal (reintentar es seguro por la Idempotency-Key)', async () => {
    const { api, signer } = fakes([{ ok: false, status: 0, problem: { code: 'NETWORK' } }]);
    expect(await submitTransfer({ api, signer, deviceId: 'd' }, op, 'k')).toMatchObject({ code: 'NETWORK', message: expect.stringMatching(/no se cobrará dos veces/) });
  });
});
