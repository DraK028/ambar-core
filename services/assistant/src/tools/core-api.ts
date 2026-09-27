import type { Account, MovementPage, NotificationInbox } from '@ambar/api-client';

/**
 * Acceso al core con el token del propio usuario. El asistente no tiene credenciales de base
 * de datos ni un token propio: ve exactamente lo que el usuario vería en la app, y el core
 * vuelve a aplicar sus reglas (scopes, BOLA). Solo usa rutas GET.
 */
export interface CoreApi {
  listAccounts(): Promise<Account[]>;
  listMovements(accountId: string, opts?: { limit?: number; cursor?: string }): Promise<MovementPage>;
  inbox(): Promise<NotificationInbox>;
}

export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`El core respondió ${status} ${code}`);
  }
}

export function httpCoreApi(baseUrl: string, accessToken: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): CoreApi {
  const base = baseUrl.replace(/\/$/, '');

  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CoreError(503, 'CORE_UNREACHABLE');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      throw new CoreError(res.status, body.code ?? `HTTP_${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    listAccounts: async () => (await get<{ data: Account[] }>('/v1/accounts')).data,
    listMovements: (accountId, { limit = 100, cursor } = {}) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (cursor) q.set('cursor', cursor);
      return get<MovementPage>(`/v1/accounts/${encodeURIComponent(accountId)}/movements?${q}`);
    },
    inbox: () => get<NotificationInbox>('/v1/notifications'),
  };
}
