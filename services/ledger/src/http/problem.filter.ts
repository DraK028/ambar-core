import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, DomainErrorCode, StepUpRequiredError } from '../domain/errors';
import { ForbiddenError, UnauthenticatedError } from './auth.guard';

type ProblemCode = DomainErrorCode | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INTERNAL_ERROR' | `HTTP_${number}`;

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  INSUFFICIENT_FUNDS: 422,
  ACCOUNT_NOT_ACTIVE: 422,
  SAME_ACCOUNT: 422,
  ALREADY_REVERSED: 422,
  NOT_REVERSIBLE: 422,
  UNBALANCED_ENTRY: 500,
  STEP_UP_REQUIRED: 401,
  DEVICE_LIMIT_REACHED: 422,
  FRAUD_CASE_CLOSED: 409,
};

const TITLES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Sin permiso',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Solicitud demasiado grande',
  422: 'Operación no permitida',
  500: 'Error interno',
};

interface Problem {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  instance?: string;
  errors?: Array<{ path: string; message: string }>;
  step_up?: { reason: string; threshold?: number };
}

/** Errores de la librería http-errors (usada por body-parser): traen status 4xx y expose=true. */
function isClientHttpError(err: unknown): err is { status: number } {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; expose?: unknown };
  return typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.expose === true;
}

/** Traduce cualquier error a RFC 9457 (application/problem+json). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;
    if (exception instanceof StepUpRequiredError) {
      // RFC 9470: el token es válido, pero la operación exige una autenticación más fuerte.
      problem.step_up = { reason: exception.reason, ...(exception.threshold ? { threshold: exception.threshold } : {}) };
      res.setHeader(
        'WWW-Authenticate',
        'Bearer error="insufficient_user_authentication", error_description="Confirma la operacion con la llave biometrica del dispositivo"',
      );
    }

    if (problem.status >= 500) {
      this.logger.error(`${req.method} ${req.originalUrl} → ${problem.code}`, (exception as Error)?.stack);
    }
    res.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof DomainError) {
      const status = STATUS_BY_CODE[exception.code];
      return this.build(status, exception.code, status >= 500 ? undefined : exception.message, exception.details);
    }
    if (exception instanceof UnauthenticatedError) {
      return this.build(401, 'UNAUTHENTICATED', exception.message);
    }
    if (exception instanceof ForbiddenError) {
      return this.build(403, 'FORBIDDEN', exception.message);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ProblemCode =
        status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : `HTTP_${status}`;
      const detail = status === 404 ? 'La ruta no existe.' : exception.message;
      return this.build(status, code, detail);
    }
    if (isClientHttpError(exception)) {
      // Errores de body-parser (JSON mal formado, cuerpo demasiado grande).
      const status = exception.status;
      const detail = status === 413 ? 'El cuerpo excede el tamaño máximo de 16 KB.' : 'El cuerpo no es JSON válido.';
      return this.build(status, status === 400 ? 'VALIDATION_ERROR' : `HTTP_${status}`, detail);
    }
    return this.build(500, 'INTERNAL_ERROR');
  }

  private build(status: number, code: ProblemCode, detail?: string, errors?: Problem['errors']): Problem {
    const problem: Problem = {
      type: `https://docs.ambar.example/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: TITLES[status] ?? 'Error',
      status,
      code,
    };
    if (detail) problem.detail = detail;
    if (errors?.length) problem.errors = errors;
    return problem;
  }
}
