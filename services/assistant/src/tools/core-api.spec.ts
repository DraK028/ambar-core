import { CoreError, httpCoreApi } from './core-api';

describe('cliente del core', () => {
  it('solo hace GET con el token del usuario', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.includes('/movements') ? { data: [], next_cursor: null } : url.endsWith('/notifications') ? { data: [], unread_count: 0 } : { data: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const core = httpCoreApi('http://core/', 'tok', fetchImpl);
    await core.listAccounts();
    await core.listMovements('a b', { limit: 5, cursor: '9' });
    await core.inbox();
    expect(calls.map((c) => c.url)).toEqual([
      'http://core/v1/accounts',
      'http://core/v1/accounts/a%20b/movements?limit=5&cursor=9',
      'http://core/v1/notifications',
    ]);
    expect(calls.every((c) => c.init.method === 'GET' && (c.init.headers as any).authorization === 'Bearer tok')).toBe(true);
  });

  it('traduce errores HTTP y de red', async () => {
    const problem = httpCoreApi('http://core', 't', (async () => new Response('{"code":"UNAUTHENTICATED"}', { status: 401 })) as any);
    await expect(problem.listAccounts()).rejects.toEqual(new CoreError(401, 'UNAUTHENTICATED'));
    const down = httpCoreApi('http://core', 't', (async () => { throw new TypeError('fetch failed'); }) as any);
    await expect(down.inbox()).rejects.toMatchObject({ status: 503, code: 'CORE_UNREACHABLE' });
    const html = httpCoreApi('http://core', 't', (async () => new Response('<html>', { status: 502 })) as any);
    await expect(html.listAccounts()).rejects.toMatchObject({ status: 502, code: 'HTTP_502' });
  });
});
