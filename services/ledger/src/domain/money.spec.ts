import { ValidationError } from './errors';
import { assertMinorUnits, assertOperationAmount, formatMXN, MAX_OPERATION_AMOUNT } from './money';

describe('montos en centavos', () => {
  it('acepta enteros distintos de cero', () => {
    expect(() => assertMinorUnits(1)).not.toThrow();
    expect(() => assertMinorUnits(-250)).not.toThrow();
  });

  it('rechaza decimales, cero y valores no seguros', () => {
    expect(() => assertMinorUnits(0.1)).toThrow(ValidationError);
    expect(() => assertMinorUnits(0)).toThrow(ValidationError);
    expect(() => assertMinorUnits(Number.NaN)).toThrow(ValidationError);
    expect(() => assertMinorUnits(2 ** 53)).toThrow(ValidationError);
  });

  it('limita el monto por operación a $50,000.00', () => {
    expect(() => assertOperationAmount(MAX_OPERATION_AMOUNT)).not.toThrow();
    expect(() => assertOperationAmount(MAX_OPERATION_AMOUNT + 1)).toThrow(ValidationError);
    expect(() => assertOperationAmount(-1)).toThrow(ValidationError);
  });

  it('formatea en pesos mexicanos', () => {
    expect(formatMXN(125_050)).toBe('$1,250.50');
    expect(formatMXN(5)).toBe('$0.05');
  });
});
