import { UnbalancedEntryError } from './errors';
import { assertMinorUnits } from './money';

export type EntryKind = 'TRANSFER' | 'DEPOSIT' | 'REVERSAL';

/** Un renglón del asiento. Débito > 0, crédito < 0, en centavos. */
export interface PostingInput {
  accountId: string;
  amount: number;
}

/**
 * Regla fundamental de la doble partida: al menos dos postings, ninguno en cero
 * y la suma exactamente cero. La base de datos vuelve a validar lo mismo al hacer
 * COMMIT; esta función falla antes y con un mensaje claro.
 */
export function assertBalanced(postings: readonly PostingInput[]): void {
  if (postings.length < 2) {
    throw new UnbalancedEntryError('Un asiento necesita al menos dos postings.');
  }
  let sum = 0;
  for (const [i, p] of postings.entries()) {
    assertMinorUnits(p.amount, `postings[${i}].amount`);
    sum += p.amount;
  }
  if (sum !== 0) {
    throw new UnbalancedEntryError(`El asiento no cuadra: la suma de los postings es ${sum}, debe ser 0.`);
  }
}

/**
 * Transferencia entre dos cuentas de cliente (ambas de saldo acreedor).
 * Se debita el origen (baja su saldo) y se acredita el destino (sube su saldo).
 */
export function transferPostings(sourceId: string, destinationId: string, amount: number): PostingInput[] {
  return [
    { accountId: sourceId, amount },
    { accountId: destinationId, amount: -amount },
  ];
}

/**
 * Depósito SPEI entrante: sube el activo de liquidación con Banxico (débito)
 * y sube el pasivo con el cliente (crédito).
 */
export function depositPostings(settlementId: string, customerId: string, amount: number): PostingInput[] {
  return [
    { accountId: settlementId, amount },
    { accountId: customerId, amount: -amount },
  ];
}

/** El reverso invierte el signo de cada posting del asiento original. */
export function reversalPostings(original: readonly PostingInput[]): PostingInput[] {
  return original.map((p) => ({ accountId: p.accountId, amount: -p.amount }));
}
