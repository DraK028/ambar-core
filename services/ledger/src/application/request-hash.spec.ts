import { canonicalJson, requestHash } from './request-hash';

describe('huella de solicitud', () => {
  it('el orden de las llaves no cambia el JSON canónico', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson(null)).toBe('null');
  });

  it('cuerpos equivalentes producen el mismo hash', () => {
    const a = requestHash('transfer', { amount: 100, concept: 'Renta' });
    const b = requestHash('transfer', { concept: 'Renta', amount: 100 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un cambio de monto u operación cambia el hash', () => {
    const base = requestHash('transfer', { amount: 100 });
    expect(requestHash('transfer', { amount: 101 })).not.toBe(base);
    expect(requestHash('deposit', { amount: 100 })).not.toBe(base);
  });
});
