import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors as joseErrors, JWTPayload, jwtVerify } from 'jose';
import { APP_CONFIG, AppConfig } from '../config';

export interface Principal {
  sub: string;
  scopes: Set<string>;
  /** Grupos de Cognito del usuario (claim cognito:groups). Vacío en tokens máquina a máquina. */
  groups: Set<string>;
  clientId: string | null;
}

export class InvalidTokenError extends Error {}

export const LOCAL_ISSUER = 'ambar-local';

/**
 * Valida access tokens de Cognito (JWKS) o, en local, tokens HS256 con la misma
 * forma de claims: sub, scope, client_id y token_use=access.
 */
@Injectable()
export class TokenVerifier {
  private readonly verifyFn: (token: string) => Promise<JWTPayload>;
  private readonly allowedClients: Set<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.allowedClients = new Set(
      (config.COGNITO_CLIENT_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

    if (config.AUTH_MODE === 'cognito') {
      const issuer = config.COGNITO_ISSUER!;
      const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
      this.verifyFn = async (t) => (await jwtVerify(t, jwks, { issuer, algorithms: ['RS256'] })).payload;
    } else {
      const key = new TextEncoder().encode(config.LOCAL_JWT_SECRET!);
      this.verifyFn = async (t) => (await jwtVerify(t, key, { issuer: LOCAL_ISSUER, algorithms: ['HS256'] })).payload;
    }
  }

  async verify(token: string): Promise<Principal> {
    let payload: JWTPayload;
    try {
      payload = await this.verifyFn(token);
    } catch (err) {
      const reason = err instanceof joseErrors.JWTExpired ? 'El token expiró.' : 'El token no es válido.';
      throw new InvalidTokenError(reason);
    }
    if (payload.token_use !== 'access') {
      throw new InvalidTokenError('Se requiere un access token, no un ID token.');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new InvalidTokenError('El token no tiene sujeto.');
    }
    const clientId = typeof payload.client_id === 'string' ? payload.client_id : null;
    if (this.allowedClients.size > 0 && (!clientId || !this.allowedClients.has(clientId))) {
      throw new InvalidTokenError('El token fue emitido para un cliente no autorizado.');
    }
    const prefix = this.config.SCOPE_PREFIX;
    const scopes = new Set(
      String(payload.scope ?? '')
        .split(' ')
        .filter(Boolean)
        .map((s) => (s.startsWith(prefix) ? s.slice(prefix.length) : s)),
    );
    const rawGroups = payload['cognito:groups'];
    const groups = new Set(Array.isArray(rawGroups) ? rawGroups.filter((g): g is string => typeof g === 'string') : []);
    return { sub: payload.sub, scopes, groups, clientId };
  }
}
