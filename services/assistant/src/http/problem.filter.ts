import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AssistantUnavailableError,
  ConversationFullError,
  ConversationNotFoundError,
  DailyLimitError,
} from '../application/assistant.service';
import { ConversationConflictError } from '../conversation/store';
import { CoreError } from '../tools/core-api';
import { ForbiddenError, UnauthenticatedError } from './auth.guard';

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly errors: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

const TITLES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Sin permiso',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Solicitud demasiado grande',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
  503: 'Servicio no disponible',
};

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: Array<{ path: string; message: string }>;
}

/** Mismo formato RFC 9457 que el Ledger. Nunca incluye el mensaje del usuario ni la respuesta del modelo. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const p = this.toProblem(exception);
    p.instance = req.originalUrl.split('?')[0];
    if (p.status >= 500) this.logger.error(`${req.method} ${p.instance} → ${p.code}: ${(exception as Error)?.message}`);
    if (p.status === 429) res.setHeader('Retry-After', '3600');
    res.status(p.status).type('application/problem+json').send(JSON.stringify(p));
  }

  private toProblem(e: unknown): Problem {
    if (e instanceof ValidationError) return this.build(400, 'VALIDATION_ERROR', e.message, e.errors);
    if (e instanceof UnauthenticatedError) return this.build(401, 'UNAUTHENTICATED', e.message);
    if (e instanceof CoreError && e.status === 401) return this.build(401, 'UNAUTHENTICATED', 'La sesión venció. Inicia sesión de nuevo.');
    if (e instanceof ForbiddenError) return this.build(403, 'FORBIDDEN', e.message);
    if (e instanceof ConversationNotFoundError) return this.build(404, 'NOT_FOUND', 'La conversación no existe o ya venció.');
    if (e instanceof ConversationFullError) {
      return this.build(409, 'CONVERSATION_FULL', 'Esta conversación llegó a su límite de mensajes. Empieza una nueva.');
    }
    if (e instanceof ConversationConflictError) {
      return this.build(409, 'CONVERSATION_BUSY', 'Ya hay un mensaje en proceso en esta conversación. Espera la respuesta.');
    }
    if (e instanceof DailyLimitError) return this.build(429, 'RATE_LIMITED', 'Llegaste al límite diario de mensajes del asistente. Vuelve mañana.');
    if (e instanceof AssistantUnavailableError) {
      return this.build(503, 'ASSISTANT_UNAVAILABLE', 'El asistente no está disponible en este momento. Tus cuentas no se ven afectadas.');
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : `HTTP_${status}`;
      return this.build(status, code, status === 404 ? 'La ruta no existe.' : e.message);
    }
    const httpError = e as { status?: number; expose?: boolean };
    if (typeof httpError?.status === 'number' && httpError.status >= 400 && httpError.status < 500 && httpError.expose) {
      const status = httpError.status;
      return this.build(status, status === 400 ? 'VALIDATION_ERROR' : `HTTP_${status}`, status === 413 ? 'El cuerpo excede 8 KB.' : 'El cuerpo no es JSON válido.');
    }
    return this.build(500, 'INTERNAL_ERROR');
  }

  private build(status: number, code: string, detail?: string, errors?: Problem['errors']): Problem {
    const p: Problem = {
      type: `https://docs.ambar.example/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: TITLES[status] ?? 'Error',
      status,
      code,
    };
    if (detail) p.detail = detail;
    if (errors?.length) p.errors = errors;
    return p;
  }
}
