'use server';

import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { LedgerProblem, createTransfer } from '@/lib/ledger';
import { GENERIC_ERROR, TRANSFER_FIELD, messageFor } from '@/lib/problems';
import type { TransferState } from './types';

/** El navegador puede mandar cualquier cosa: se valida otra vez aquí, igual que en el contrato. */
const Input = z.object({
  source: z.string().uuid(),
  clabe: z.string().regex(/^\d{18}$/),
  amount: z.coerce.number().int().min(1).max(5_000_000),
  concept: z.string().trim().min(1).max(40),
  idempotencyKey: z.string().uuid(),
});

export async function transferAction(_prev: TransferState, form: FormData): Promise<TransferState> {
  const parsed = Input.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { status: 'error', message: 'Revisa los datos de la transferencia e intenta de nuevo.' };
  }
  const { source, clabe, amount, concept, idempotencyKey } = parsed.data;

  try {
    // La misma Idempotency-Key en cada reintento del mismo resumen: si la red falla después
    // de que el core registró la transferencia, reintentar no cobra dos veces.
    const t = await createTransfer({ source_account_id: source, destination_clabe: clabe, amount, concept }, idempotencyKey);
    return {
      status: 'ok',
      receipt: { id: t.id, amount: t.amount, concept: t.concept, destinationClabe: clabe, createdAt: t.created_at, sourceId: source },
    };
  } catch (err) {
    unstable_rethrow(err); // deja pasar el redirect a /entrar si la sesión venció
    if (err instanceof LedgerProblem) {
      if (err.code === 'NOT_FOUND') {
        return { status: 'error', message: messageFor('NOT_FOUND'), field: 'clabe', fieldMessage: messageFor('NOT_FOUND') };
      }
      if (err.code === 'INSUFFICIENT_FUNDS') {
        return { status: 'error', message: messageFor(err.code), field: 'amount', fieldMessage: messageFor(err.code) };
      }
      if (err.code === 'SAME_ACCOUNT') {
        return { status: 'error', message: messageFor(err.code), field: 'clabe', fieldMessage: messageFor(err.code) };
      }
      const first = err.errors[0];
      const field = first ? TRANSFER_FIELD[first.path] : undefined;
      return { status: 'error', message: messageFor(err.code), field, fieldMessage: field ? messageFor(err.code) : undefined };
    }
    console.error('Transferencia fallida', err instanceof Error ? err.message : err);
    return { status: 'error', message: GENERIC_ERROR };
  }
}
