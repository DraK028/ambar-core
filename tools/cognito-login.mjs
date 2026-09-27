#!/usr/bin/env node
/**
 * Obtiene un access token de Cognito para probar la API desplegada.
 *
 * Usuario (Authorization Code + PKCE, abre el navegador):
 *   node tools/cognito-login.mjs --domain https://ambar-dev-xxxx.auth.us-east-1.amazoncognito.com \
 *                                --client-id <client_ids.cli>
 *
 * Operador (cliente ops; tu usuario debe estar en el grupo operators):
 *   node tools/cognito-login.mjs --domain ... --client-id <client_ids.ops> \
 *                                --scopes "openid ambar-api/ledger.admin ambar-api/accounts.read"
 *
 * Automatización de QA (client credentials, sin navegador):
 *   QA_CLIENT_SECRET=... node tools/cognito-login.mjs --domain ... --client-id <client_ids.qa> --m2m
 *
 * Imprime solo el token en stdout para poder usarlo así:
 *   TOKEN=$(node tools/cognito-login.mjs ...)
 *
 * Nota: los scopes propios (ambar-api/*) solo se emiten por los flujos OAuth2 de
 * Cognito; un login con usuario y contraseña vía API (USER_PASSWORD_AUTH) no los incluye.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    domain: { type: 'string' },
    'client-id': { type: 'string' },
    scopes: { type: 'string', default: 'openid email ambar-api/accounts.read ambar-api/accounts.write ambar-api/transfers.write' },
    port: { type: 'string', default: '8765' },
    m2m: { type: 'boolean', default: false },
  },
});

const domain = (args.domain ?? process.env.COGNITO_DOMAIN ?? '').replace(/\/$/, '');
const clientId = args['client-id'] ?? process.env.COGNITO_CLIENT_ID;
if (!domain || !clientId) {
  console.error('Faltan --domain y --client-id (outputs cognito.hosted_domain y cognito.client_ids de Terraform).');
  process.exit(2);
}

const log = (msg) => console.error(msg); // stderr: stdout queda libre para el token
const b64url = (buf) => buf.toString('base64url');

async function token(body, headers = {}) {
  const res = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cognito respondió ${res.status}: ${json.error ?? 'sin detalle'}`);
  return json;
}

function describe(accessToken) {
  const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
  const expires = new Date(claims.exp * 1000).toLocaleTimeString('es-MX');
  log(`✓ Token para ${claims.username ?? claims.sub} · scopes: ${claims.scope} · expira ${expires}`);
  if (claims['cognito:groups']) log(`  grupos: ${claims['cognito:groups'].join(', ')}`);
}

async function machineToMachine() {
  const secret = process.env.QA_CLIENT_SECRET;
  if (!secret) throw new Error('Define QA_CLIENT_SECRET (aws cognito-idp describe-user-pool-client ... --query UserPoolClient.ClientSecret).');
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await token({ grant_type: 'client_credentials', scope: 'ambar-api/qa.write' }, { Authorization: `Basic ${basic}` });
  return res.access_token;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* si no hay navegador, el usuario abre la URL a mano */
  }
}

function authorizationCode() {
  const port = Number(args.port);
  const redirectUri = `http://localhost:${port}/callback`;
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authorizeUrl = new URL(`${domain}/oauth2/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: args.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const finish = (status, text, err, value) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Ámbar</title><p style="font:16px system-ui;margin:3rem">${text}</p>`);
        server.close();
        err ? reject(err) : resolve(value);
      };
      if (url.searchParams.get('state') !== state) {
        return finish(400, 'El parámetro state no coincide. Vuelve a intentarlo.', new Error('state inválido'));
      }
      if (url.searchParams.get('error')) {
        const e = url.searchParams.get('error_description') ?? url.searchParams.get('error');
        return finish(400, `Cognito rechazó el inicio de sesión: ${e}`, new Error(e));
      }
      try {
        const tokens = await token({
          grant_type: 'authorization_code',
          client_id: clientId,
          code: url.searchParams.get('code'),
          redirect_uri: redirectUri,
          code_verifier: verifier,
        });
        finish(200, 'Listo. Ya puedes cerrar esta pestaña y volver a la terminal.', null, tokens.access_token);
      } catch (err) {
        finish(500, 'No se pudo canjear el código por un token. Revisa la terminal.', err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      log('Abre esta URL para iniciar sesión (se intentó abrir el navegador):');
      log(authorizeUrl.toString());
      openBrowser(authorizeUrl.toString());
    });
    setTimeout(() => {
      server.close();
      reject(new Error('Tiempo agotado: no se completó el inicio de sesión en 3 minutos.'));
    }, 180_000).unref();
  });
}

try {
  const accessToken = args.m2m ? await machineToMachine() : await authorizationCode();
  describe(accessToken);
  process.stdout.write(`${accessToken}\n`);
} catch (err) {
  log(`✗ ${err.message}`);
  process.exit(1);
}
