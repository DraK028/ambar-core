import 'server-only';
import { redirect } from 'next/navigation';
import { createAmbarClient, type Account, type AmbarClient, type MovementPage, type Problem, type Transfer } from '@ambar/api-client';
import { config } from './config';
import { getSession, type ActiveSession } from './session/session';

/**
 * Capa de acceso al core. Es el único lugar que conoce el access token: los componentes
 * reciben datos, nunca tokens. Todo corre en el servidor.
 */

export class LedgerProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string | undefined,
    readonly errors: Array<{ path: string; message: string }> = [],
  ) {
    super(`${status} ${code}${detail ? `: ${detail}` : ''}`);
  }
}

async function requireSession(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) redirect('/entrar?motivo=expirada');
  return session;
}

async function client(): Promise<AmbarClient> {
  const session = await requireSession();
  return createAmbarClient(config().LEDGER_API_URL, session.accessToken, (input, init) =>
    fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
  );
}

type Result<T> = { data?: T; error?: unknown; response: Response };

function unwrap<T>(result: Result<T>): T {
  if (result.error !== undefined || result.data === undefined) {
    const p = (result.error ?? {}) as Partial<Problem>;
    if (result.response.status === 401) redirect('/entrar?motivo=expirada');
    throw new LedgerProblem(result.response.status, p.code ?? `HTTP_${result.response.status}`, p.detail, p.errors ?? []);
  }
  return result.data;
}

export async function listAccounts(): Promise<Account[]> {
  const api = await client();
  return unwrap(await api.GET('/v1/accounts')).data;
}

/** null si la cuenta no existe o no es del usuario (el core responde 404 en ambos casos). */
export async function getAccount(id: string): Promise<Account | null> {
  const api = await client();
  const res = await api.GET('/v1/accounts/{accountId}', { params: { path: { accountId: id } } });
  if (res.response.status === 404 || res.response.status === 400) return null;
  return unwrap(res);
}

export async function listMovements(id: string, opts: { cursor?: string; limit?: number } = {}): Promise<MovementPage | null> {
  const api = await client();
  const res = await api.GET('/v1/accounts/{accountId}/movements', {
    params: { path: { accountId: id }, query: { limit: opts.limit ?? 20, cursor: opts.cursor } },
  });
  if (res.response.status === 404) return null;
  return unwrap(res);
}

export async function openAccount(): Promise<Account> {
  const api = await client();
  return unwrap(await api.POST('/v1/accounts'));
}

export async function createTransfer(
  body: { source_account_id: string; destination_clabe: string; amount: number; concept: string },
  idempotencyKey: string,
): Promise<Transfer> {
  const api = await client();
  return unwrap(
    await api.POST('/v1/transfers', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body,
    }),
  );
}
