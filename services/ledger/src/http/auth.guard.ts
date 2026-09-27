import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../config';
import type { Request } from 'express';
import { InvalidTokenError, Principal, TokenVerifier } from './token-verifier';

export type Scope =
  | 'accounts.read'
  | 'accounts.write'
  | 'transfers.write'
  | 'devices.write'
  | 'ledger.admin'
  | 'qa.write'
  | 'internal.notify'
  | 'internal.fraud'
  | 'internal.reconcile';

const SCOPES_KEY = 'ambar:scopes';
const PUBLIC_KEY = 'ambar:public';

/** El endpoint exige todos estos scopes en el access token. */
export const RequireScopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);
/** El endpoint no requiere autenticación (solo /health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export class UnauthenticatedError extends Error {}
export class ForbiddenError extends Error {}

interface AuthedRequest extends Request {
  principal?: Principal;
}

/**
 * Guard global: todo endpoint requiere token salvo que se marque @Public().
 * Denegar por defecto evita que un endpoint nuevo quede abierto por olvido.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new UnauthenticatedError('Falta el header Authorization: Bearer <token>.');

    try {
      req.principal = await this.verifier.verify(match[1]);
    } catch (err) {
      if (err instanceof InvalidTokenError) throw new UnauthenticatedError(err.message);
      throw err;
    }

    const required = this.reflector.getAllAndOverride<Scope[]>(SCOPES_KEY, targets) ?? [];
    if (required.length === 0) {
      // Un endpoint autenticado sin scopes declarados es un error de programación.
      throw new ForbiddenError('El endpoint no declara scopes requeridos.');
    }
    const missing = required.filter((s) => !req.principal!.scopes.has(s));
    if (missing.length > 0) {
      throw new ForbiddenError(`El token no tiene el scope requerido: ${missing.join(', ')}.`);
    }
    // En Cognito los scopes se asignan por app client: cualquier usuario que entre por el
    // cliente de operación recibiría ledger.admin. El grupo es lo que identifica al operador.
    if (required.includes('ledger.admin') && !req.principal.groups.has(this.config.ADMIN_GROUP)) {
      throw new ForbiddenError(`La operación requiere pertenecer al grupo ${this.config.ADMIN_GROUP}.`);
    }
    // API interna: además del scope, el token debe venir de un cliente máquina conocido (n8n).
    // Si alguien agregara por error un scope interno a un cliente de usuarios, seguiría sin entrar.
    if (required.some((s) => s.startsWith('internal.')) && !this.internalClients.has(req.principal.clientId ?? '')) {
      throw new ForbiddenError('La API interna solo acepta tokens de los clientes de automatización.');
    }
    return true;
  }

  private get internalClients(): Set<string> {
    return new Set(this.config.INTERNAL_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean));
  }
}

/** Inyecta el usuario autenticado en el handler. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.principal) throw new UnauthenticatedError('No autenticado.');
  return req.principal;
});
