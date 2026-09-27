/**
 * CLABE: 18 dígitos. Verificador: pesos 3-7-1 sobre los primeros 17, cada producto
 * módulo 10, se suman y el verificador es (10 - suma mod 10) mod 10.
 * Mismo algoritmo que services/ledger/src/domain/clabe.ts, probado con los mismos vectores.
 */
const WEIGHTS = [3, 7, 1] as const;

export function normalizeClabe(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function clabeCheckDigit(first17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

export type ClabeCheck = { ok: true; clabe: string } | { ok: false; reason: string };

export function checkClabe(input: string): ClabeCheck {
  const clabe = normalizeClabe(input);
  if (clabe.length === 0) return { ok: false, reason: 'Escribe la CLABE de destino.' };
  if (!/^\d+$/.test(clabe)) return { ok: false, reason: 'La CLABE solo lleva números.' };
  if (clabe.length !== 18) return { ok: false, reason: `La CLABE tiene 18 dígitos; llevas ${clabe.length}.` };
  if (clabeCheckDigit(clabe.slice(0, 17)) !== Number(clabe[17])) {
    return { ok: false, reason: 'El último dígito no coincide. Revisa la CLABE con quien te la dio.' };
  }
  return { ok: true, clabe };
}

/** "999180000000000015" → "999 180 00000000001 5" */
export function formatClabe(clabe: string): string {
  const c = normalizeClabe(clabe);
  if (c.length !== 18) return c;
  return `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 17)} ${c.slice(17)}`;
}

/** Últimos 4 dígitos, para identificar una cuenta sin mostrar la CLABE completa. */
export function lastFour(clabe: string): string {
  return normalizeClabe(clabe).slice(-4);
}
