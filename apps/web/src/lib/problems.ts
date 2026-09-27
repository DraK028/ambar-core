/** Mensajes para el cliente a partir del `code` estable de los errores RFC 9457 del core. */
const MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'No tienes saldo suficiente para esta transferencia.',
  ACCOUNT_NOT_ACTIVE: 'La cuenta no está activa para esta operación. Si crees que es un error, contáctanos.',
  SAME_ACCOUNT: 'La cuenta de destino es la misma que la de origen.',
  NOT_FOUND: 'No encontramos una cuenta Ámbar con esa CLABE.',
  IDEMPOTENCY_KEY_REUSED: 'Esta operación ya se había enviado con otros datos. Revisa tus movimientos antes de intentar de nuevo.',
  RATE_LIMITED: 'Hiciste muchas solicitudes seguidas. Espera un momento e intenta de nuevo.',
  VALIDATION_ERROR: 'Algunos datos no son válidos. Revísalos e intenta de nuevo.',
  FORBIDDEN: 'Tu sesión no tiene permiso para esta operación.',
};

export const GENERIC_ERROR = 'No pudimos completar la operación. Tu dinero no se movió; intenta de nuevo en unos minutos.';

export function messageFor(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}

/** Campos del contrato → nombres de campos del formulario de transferencia. */
export const TRANSFER_FIELD: Record<string, 'source' | 'clabe' | 'amount' | 'concept'> = {
  source_account_id: 'source',
  destination_clabe: 'clabe',
  amount: 'amount',
  concept: 'concept',
};
