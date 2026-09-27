import { describe, expect, it } from 'vitest';
import { formatMXN, parsePesos, splitAmount } from './money';

describe('parsePesos', () => {
  it.each([
    ['1250', 125_000],
    ['1,250', 125_000],
    ['1,250.5', 125_050],
    ['1,250.50', 125_050],
    ['$ 1,250.50', 125_050],
    ['0.05', 5],
    ['0.1', 10],
    ['1234567.89', 123_456_789],
    ['12.', 1_200],
  ])('%s → %i centavos', (input, expected) => {
    expect(parsePesos(input)).toEqual({ ok: true, centavos: expected });
  });

  it('no usa punto flotante: 0.1 + 0.2 no se convierte en 30.000000000000004', () => {
    expect(parsePesos('0.29')).toEqual({ ok: true, centavos: 29 });
    expect(parsePesos('1.15')).toEqual({ ok: true, centavos: 115 });
  });

  it.each(['', '  ', 'abc', '-5', '1.234', '1,25', '12,34,567', '1.2.3', '0', '0.00'])('rechaza %j', (input) => {
    expect(parsePesos(input).ok).toBe(false);
  });
});

describe('formato', () => {
  it('formatea en pesos mexicanos', () => {
    expect(formatMXN(125_050)).toBe('$1,250.50');
    expect(formatMXN(0)).toBe('$0.00');
  });

  it('separa pesos y centavos para mostrarlos con distinto tamaño', () => {
    expect(splitAmount(2_455_000)).toEqual({ sign: '', pesos: '24,550', cents: '00' });
    expect(splitAmount(-45_005)).toEqual({ sign: '-', pesos: '450', cents: '05' });
  });
});
