/**
 * Errores de dominio. No conocen HTTP: el filtro de la capa web los traduce
 * a respuestas RFC 9457 usando `code`.
 */
export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_FUNDS'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'SAME_ACCOUNT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ALREADY_REVERSED'
  | 'NOT_REVERSIBLE'
  | 'UNBALANCED_ENTRY'
  | 'STEP_UP_REQUIRED'
  | 'DEVICE_LIMIT_REACHED'
  | 'FRAUD_CASE_CLOSED';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Array<{ path: string; message: string }>) {
    super('VALIDATION_ERROR', message, details);
  }
}

const NOT_FOUND_MESSAGES = {
  account: 'La cuenta no existe.',
  entry: 'El asiento no existe.',
  device: 'El dispositivo no existe o ya fue revocado.',
  notification: 'El aviso no existe.',
  fraud_case: 'El caso no existe.',
} as const;

export class NotFoundError extends DomainError {
  constructor(resource: keyof typeof NOT_FOUND_MESSAGES) {
    super('NOT_FOUND', NOT_FOUND_MESSAGES[resource]);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(readonly accountId?: string) {
    super('INSUFFICIENT_FUNDS', 'La cuenta no tiene saldo suficiente para esta operación.');
  }
}

export class AccountNotActiveError extends DomainError {
  constructor(readonly accountId: string, status: string) {
    super('ACCOUNT_NOT_ACTIVE', `La cuenta está en estado ${status} y no permite esta operación.`);
  }
}

export class SameAccountError extends DomainError {
  constructor() {
    super('SAME_ACCOUNT', 'La cuenta de origen y la de destino son la misma.');
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super('IDEMPOTENCY_KEY_REUSED', 'La Idempotency-Key ya se usó con un cuerpo distinto. Genera una llave nueva para otra operación.');
  }
}

export class AlreadyReversedError extends DomainError {
  constructor() {
    super('ALREADY_REVERSED', 'Este asiento ya tiene un reverso registrado.');
  }
}

export class NotReversibleError extends DomainError {
  constructor() {
    super('NOT_REVERSIBLE', 'Un asiento de reverso no se puede reversar; registra una operación nueva.');
  }
}

export class UnbalancedEntryError extends DomainError {
  constructor(message: string) {
    super('UNBALANCED_ENTRY', message);
  }
}

export type StepUpReason = 'AMOUNT_THRESHOLD' | 'NEW_BENEFICIARY' | 'INVALID_PROOF';

const STEP_UP_MESSAGES: Record<StepUpReason, string> = {
  AMOUNT_THRESHOLD: 'Por el monto, confirma la transferencia con la biometría de tu dispositivo.',
  NEW_BENEFICIARY: 'Es la primera vez que transfieres a esta cuenta: confírmalo con la biometría de tu dispositivo.',
  INVALID_PROOF: 'La confirmación biométrica no es válida o ya se usó. Vuelve a confirmar la operación.',
};

/** RFC 9470: la operación necesita una autenticación más fuerte que el access token. */
export class StepUpRequiredError extends DomainError {
  constructor(
    readonly reason: StepUpReason,
    readonly threshold?: number,
  ) {
    super('STEP_UP_REQUIRED', STEP_UP_MESSAGES[reason]);
  }
}

export class DeviceLimitReachedError extends DomainError {
  constructor(readonly limit: number) {
    super('DEVICE_LIMIT_REACHED', `Ya tienes ${limit} dispositivos activos. Revoca uno antes de registrar otro.`);
  }
}

export class FraudCaseClosedError extends DomainError {
  constructor() {
    super('FRAUD_CASE_CLOSED', 'Este caso ya se respondió con otra respuesta. Si hubo un error, comunícate con Ámbar.');
  }
}
