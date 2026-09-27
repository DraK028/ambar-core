import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FakeCore } from './fake-core';

/** El core por HTTP (datos de FakeCore). Registra método y ruta de cada llamada y exige el token. */
export async function startCoreStub(token: string, core = new FakeCore()): Promise<{ url: string; core: FakeCore; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = [];
  const server: Server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { code: 'UNAUTHENTICATED' });
    if (req.method !== 'GET') return send(405, { code: 'HTTP_405' });
    const url = new URL(req.url!, 'http://x');
    const m = /^\/v1\/accounts\/([^/]+)\/movements$/.exec(url.pathname);
    if (url.pathname === '/v1/accounts') return send(200, { data: await core.listAccounts() });
    if (m) return send(200, await core.listMovements(m[1], { limit: Number(url.searchParams.get('limit') ?? 100), cursor: url.searchParams.get('cursor') ?? undefined }));
    if (url.pathname === '/v1/notifications') return send(200, await core.inbox());
    send(404, { code: 'NOT_FOUND' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    core,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
