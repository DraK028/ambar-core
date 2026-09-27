import { parseStepUpProof, signingPayload, stepUpReason } from './step-up';

describe('política de step-up', () => {
  const threshold = 500_000;

  it('exige confirmación desde el umbral, aunque el destino sea conocido', () => {
    expect(stepUpReason({ amount: 500_000, threshold, knownBeneficiary: true })).toBe('AMOUNT_THRESHOLD');
    expect(stepUpReason({ amount: 499_999, threshold, knownBeneficiary: true })).toBeNull();
  });

  it('exige confirmación para un beneficiario nuevo aunque el monto sea bajo', () => {
    expect(stepUpReason({ amount: 100, threshold, knownBeneficiary: false })).toBe('NEW_BENEFICIARY');
  });
});

describe('payload firmado', () => {
  it('liga la firma al reto, al nonce y al hash de la operación', () => {
    expect(signingPayload('c-1', 'n-1', 'h-1')).toBe('ambar-step-up:v1\nc-1\nn-1\nh-1');
  });

  it('interpreta el header X-Step-Up', () => {
    const id = '0b6c2f0e-6c47-4f5e-9b0e-2b9a4d1f7c11';
    const parsed = parseStepUpProof(`${id}.MEUCIQDfirmaFalsa_-123456`);
    expect(parsed?.challengeId).toBe(id);
    expect(parsed?.signature).toBeInstanceOf(Buffer);
    expect(parseStepUpProof('no-es-un-reto.abc')).toBeNull();
    expect(parseStepUpProof(`${id}.corta`)).toBeNull();
  });
});
