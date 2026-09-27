export type TransferField = 'source' | 'clabe' | 'amount' | 'concept';

export type TransferState =
  | { status: 'idle' }
  | { status: 'error'; message: string; field?: TransferField; fieldMessage?: string }
  | {
      status: 'ok';
      receipt: { id: string; amount: number; concept: string; destinationClabe: string; createdAt: string; sourceId: string };
    };
