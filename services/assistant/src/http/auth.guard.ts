import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { InvalidTokenError, Principal, TokenVerifier } from './token-verifier';

/**
 * El asistente exige `assistant.chat`. Las herramientas llaman al core con el mismo token,
 * así que el core vuelve a exigir `accounts.read` y aplica BOLA a cada consulta.
 */
export const REQUIRED_SCOPE = 'assistant.chat';
const PUBLIC_KEY = 'ambar:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export class UnauthenticatedError extends Error {}
export class ForbiddenError extends Error {}

export interface AuthedUser extends Principal {
  accessToken: string;
}

interface AuthedRequest extends Request {
  user?: AuthedUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthenticatedError('Falta el header Authorization: Bearer <token>.');
    let principal: Principal;
    try {
      principal = await this.verifier.verify(match[1]);
    } catch (err) {
      if (err instanceof InvalidTokenError) throw new UnauthenticatedError(err.message);
      throw err;
    }
    if (!principal.scopes.has(REQUIRED_SCOPE)) throw new ForbiddenError(`El token no tiene el scope requerido: ${REQUIRED_SCOPE}.`);
    req.user = { ...principal, accessToken: match[1] };
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthedUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthenticatedError('No autenticado.');
  return user;
});
