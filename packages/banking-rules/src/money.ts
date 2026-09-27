/**
 * Montos en centavos (enteros), igual que la API. Nunca se usa aritmética de punto
 * flotante para convertir: "1,250.50" se procesa como texto.
 */

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const grouped = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

/** 125050 → "$1,250.50" */
export function formatMXN(centavos: number): string {
  return mxn.format(centavos / 100);
}

/** 125050 → { sign: '', pesos: '1,250', cents: '50' } para mostrar los centavos más pequeños. */
export function splitAmount(centavos: number): { sign: '' | '-'; pesos: string; cents: string } {
  const abs = Math.abs(centavos);
  return {
    sign: centavos < 0 ? '-' : '',
    pesos: grouped.format(Math.trunc(abs / 100)),
    cents: String(abs % 100).padStart(2, '0'),
  };
}

export type ParseResult = { ok: true; centavos: number } | { ok: false; reason: string };

/**
 * Interpreta lo que escribe el usuario: "1250", "1,250.5", "$ 1,250.50".
 * Rechaza más de dos decimales, negativos, cero y formatos ambiguos.
 */
export function parsePesos(input: string): ParseResult {
  const clean = input.replace(/[\s$]/g, '');
  if (clean === '') return { ok: false, reason: 'Escribe un monto.' };
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/.test(clean)) {
    return { ok: false, reason: 'Escribe el monto con hasta dos decimales, por ejemplo 1,250.50.' };
  }
  const [intPart, decPart = ''] = clean.replace(/,/g, '').split('.');
  const centavosText = `${intPart}${decPart.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (centavosText.length > 15) return { ok: false, reason: 'El monto es demasiado grande.' };
  const centavos = Number(centavosText);
  if (centavos === 0) return { ok: false, reason: 'El monto debe ser mayor a cero.' };
  return { ok: true, centavos };
}

/** Límite por operación del contrato: $50,000.00. */
export const MAX_TRANSFER_CENTAVOS = 5_000_000;
