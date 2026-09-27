/**
 * CLABE (Clave Bancaria Estandarizada), 18 dígitos:
 *   3 banco · 3 plaza · 11 número de cuenta · 1 dígito verificador
 *
 * Dígito verificador: se multiplica cada uno de los primeros 17 dígitos por
 * los pesos 3, 7, 1 (repetidos), se toma cada producto módulo 10, se suman,
 * y el verificador es (10 - (suma mod 10)) mod 10.
 */
const WEIGHTS = [3, 7, 1] as const;

/** Código de banco ficticio para Ámbar (proyecto de portafolio). */
export const AMBAR_BANK_CODE = '999';
/** Plaza 180: Ciudad de México. */
export const AMBAR_PLAZA_CODE = '180';

export function clabeCheckDigit(first17: string): number {
  if (!/^\d{17}$/.test(first17)) {
    throw new Error('Se requieren exactamente 17 dígitos para calcular el verificador de la CLABE.');
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidClabe(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  return clabeCheckDigit(clabe.slice(0, 17)) === Number(clabe[17]);
}

/** Construye una CLABE de Ámbar a partir del consecutivo de cuenta (1 … 99,999,999,999). */
export function buildAmbarClabe(accountNumber: number): string {
  if (!Number.isSafeInteger(accountNumber) || accountNumber < 1 || accountNumber > 99_999_999_999) {
    throw new Error('El número de cuenta debe estar entre 1 y 99,999,999,999.');
  }
  const first17 = `${AMBAR_BANK_CODE}${AMBAR_PLAZA_CODE}${String(accountNumber).padStart(11, '0')}`;
  return `${first17}${clabeCheckDigit(first17)}`;
}

/** 999180000000000015 → "999 180 00000000001 5" para mostrar en pantalla. */
export function formatClabe(clabe: string): string {
  return `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 17)} ${clabe.slice(17)}`;
}
