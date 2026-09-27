'use server';

import { redirect } from 'next/navigation';
import { openAccount } from '@/lib/ledger';

export async function openAccountAction(): Promise<void> {
  const account = await openAccount();
  redirect(`/cuentas/${account.id}?nueva=1`);
}
