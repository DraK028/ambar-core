const MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'No tienes saldo suficiente para esta transferencia.',
  ACCOUNT_NOT_ACTIVE: 'La cuenta no está activa para esta operación.',
  SAME_ACCOUNT: 'La cuenta de destino es la misma que la de origen.',
  NOT_FOUND: 'No encontramos una cuenta Ámbar con esa CLABE.',
  IDEMPOTENCY_KEY_REUSED: 'Esta operación ya se había enviado con otros datos. Revisa tus movimientos.',
  RATE_LIMITED: 'Hiciste muchas solicitudes seguidas. Espera un momento.',
  VALIDATION_ERROR: 'Algunos datos no son válidos. Revísalos e intenta de nuevo.',
  STEP_UP_REQUIRED: 'No pudimos confirmar la operación con tu dispositivo. Intenta de nuevo.',
  DEVICE_LIMIT_REACHED: 'Ya tienes 3 dispositivos activos. Revoca uno en Ajustes para activar este.',
  NETWORK: 'Sin conexión con Ámbar. Revisa tu internet; si reintentas, no se cobrará dos veces.',
};

export const GENERIC_ERROR = 'No pudimos completar la operación. Tu dinero no se movió; intenta de nuevo.';

export function messageFor(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC_ERROR;
}
