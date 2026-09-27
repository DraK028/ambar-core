import { SignJWT } from 'jose';
import { LOCAL_ISSUER } from '../http/token-verifier';

/**
 * Genera un access token local con la misma forma que uno de Cognito.
 *   npm run token -- demo-ana
 *   npm run token -- ops-carlos "ledger.admin accounts.read" operators
 */
export async function mintDevToken(
  sub: string,
  scopes = 'accounts.read accounts.write transfers.write qa.write',
  secret = process.env.LOCAL_JWT_SECRET,
  expiresIn = '1h',
  groups: string[] = [],
  clientId = 'ambar-local-client',
): Promise<string> {
  if (!secret) throw new Error('Define LOCAL_JWT_SECRET (el mismo que usa el servicio).');
  const scope = scopes
    .split(' ')
    .filter(Boolean)
    .map((s) => (s.includes('/') ? s : `ambar-api/${s}`))
    .join(' ');
  const claims: Record<string, unknown> = { scope, token_use: 'access', client_id: clientId };
  if (groups.length) claims['cognito:groups'] = groups;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(LOCAL_ISSUER)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

if (require.main === module) {
  const [sub = 'demo-ana', scopes, groups] = process.argv.slice(2);
  mintDevToken(sub, scopes || undefined, undefined, '1h', groups ? groups.split(',') : [])
    .then((t) => console.log(t))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
