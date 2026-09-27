import { ValidationError } from './errors';

/** Monto máximo por operación: $50,000.00 MXN (igual que el contrato OpenAPI). */
export const MAX_OPERATION_AMOUNT = 5_000_000;

/**
 * Valida que un valor sea un monto en centavos: entero seguro y distinto de cero.
 * Los montos nunca se representan con decimales.
 */
export function assertMinorUnits(value: number, field = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${field} debe ser un entero en centavos.`, [
      { path: field, message: 'debe ser un entero en centavos' },
    ]);
  }
  if (value === 0) {
    throw new ValidationError(`${field} no puede ser cero.`, [{ path: field, message: 'no puede ser cero' }]);
  }
}

/** Valida un monto positivo de operación dentro del límite. */
export function assertOperationAmount(value: number, field = 'amount'): void {
  assertMinorUnits(value, field);
  if (value < 0 || value > MAX_OPERATION_AMOUNT) {
    throw new ValidationError(`${field} debe estar entre 1 y ${MAX_OPERATION_AMOUNT} centavos.`, [
      { path: field, message: `debe estar entre 1 y ${MAX_OPERATION_AMOUNT}` },
    ]);
  }
}

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** 125050 → "$1,250.50". Solo para textos (notificaciones, logs); la API usa centavos. */
export function formatMXN(minor: number): string {
  return mxn.format(minor / 100);
}
