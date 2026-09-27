#!/usr/bin/env node
/**
 * Servidor de tokens SOLO PARA DESARROLLO: reemplaza a Cognito cuando la app móvil o n8n
 * corren contra el Ledger local. Emite access tokens HS256 con la misma forma que Cognito,
 * firmados con el LOCAL_JWT_SECRET del Ledger:
 *   - dev_login / refresh_token → client_id ambar-local-mobile (scopes de cliente)
 *   - client_credentials        → client_id n8n-local (scopes internal.*), con Basic auth
 *     usando N8N_CLIENT_SECRET, igual que el cliente máquina a máquina de Cognito.
 *
 *   LOCAL_JWT_SECRET=... node tools/dev-auth-server.mjs
 *   adb reverse tcp:8787 tcp:8787     # emulador de Android
 *
 * Escucha solo en 127.0.0.1. Nunca lo despliegues: cualquiera que lo alcance puede
 * obtener un token de cualquier usuario.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { SignJWT } from 'jose';

const SECRET = process.env.LOCAL_JWT_SECRET;
const PORT = Number(process.env.PORT ?? 8787);
if (!SECRET || SECRET.length < 32) {
  console.error('Define LOCAL_JWT_SECRET (el mismo del Ledger, mínimo 32 caracteres).');
  process.exit(2);
}

const SCOPES = ['accounts.read', 'accounts.write', 'transfers.write', 'devices.write', 'assistant.chat'].map((s) => `ambar-api/${s}`).join(' ');
const M2M_CLIENT = 'n8n-local';
const M2M_SECRET = process.env.N8N_CLIENT_SECRET ?? '';
const M2M_SCOPES = ['internal.notify', 'internal.fraud', 'internal.reconcile'].map((s) => `ambar-api/${s}`);
const TTL = 600;
const refreshTokens = new Map(); // refresh token → sub
const USER = /^[a-z0-9][a-z0-9-]{2,63}$/;

async function accessToken(sub, scope = SCOPES, clientId = 'ambar-local-mobile') {
  return new SignJWT({ scope, token_use: 'access', client_id: clientId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('ambar-local')
    .setIssuedAt()
    .setExpirationTime(`${TTL}s`)
    .sign(new TextEncoder().encode(SECRET));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/token') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    const grant = form.get('grant_type');

    if (grant === 'dev_login') {
      const sub = String(form.get('sub') ?? '').toLowerCase();
      if (!USER.test(sub)) return send(res, 400, { error: 'invalid_request', error_description: 'sub inválido' });
      const refresh = randomBytes(32).toString('base64url');
      refreshTokens.set(refresh, sub);
      return send(res, 200, { access_token: await accessToken(sub), refresh_token: refresh, expires_in: TTL, token_type: 'Bearer' });
    }
    if (grant === 'refresh_token') {
      const sub = refreshTokens.get(String(form.get('refresh_token')));
      if (!sub) return send(res, 400, { error: 'invalid_grant' });
      return send(res, 200, { access_token: await accessToken(sub), expires_in: TTL, token_type: 'Bearer' });
    }
    if (grant === 'client_credentials') {
      const [id, secret] = Buffer.from(String(req.headers.authorization ?? '').replace(/^Basic\s+/i, ''), 'base64')
        .toString('utf8')
        .split(':');
      const ok = id === M2M_CLIENT && M2M_SECRET.length >= 16 && secret && secret.length === M2M_SECRET.length &&
        timingSafeEqual(Buffer.from(secret), Buffer.from(M2M_SECRET));
      if (!ok) return send(res, 401, { error: 'invalid_client' });
      const requested = String(form.get('scope') ?? '').split(' ').filter(Boolean);
      const scopes = requested.length ? requested.filter((s) => M2M_SCOPES.includes(s)) : M2M_SCOPES;
      if (requested.length && scopes.length !== requested.length) return send(res, 400, { error: 'invalid_scope' });
      return send(res, 200, { access_token: await accessToken(M2M_CLIENT, scopes.join(' '), M2M_CLIENT), expires_in: TTL, token_type: 'Bearer' });
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }
  if (req.method === 'POST' && req.url === '/revoke') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    refreshTokens.delete(String(new URLSearchParams(raw).get('token')));
    return send(res, 200, {});
  }
  send(res, 404, { error: 'not_found' });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Tokens de desarrollo en http://127.0.0.1:${PORT} (NO usar fuera de tu máquina)`);
});
