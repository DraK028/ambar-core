export interface BiometricPrompt {
  /** Título del diálogo del sistema, p. ej. "Confirma tu transferencia". */
  title: string;
  /** Detalle de la operación: monto y destino. */
  subtitle?: string;
  /** Texto del botón para cancelar (Android). */
  cancel: string;
}

export interface Availability {
  /** Hay biometría fuerte (Clase 3 en Android, Face ID / Touch ID en iOS) enrolada. */
  available: boolean;
  /** La llave vive en un chip dedicado (StrongBox / Secure Enclave). */
  hardwareBacked: boolean;
  reason?: 'NO_HARDWARE' | 'NOT_ENROLLED' | 'UNAVAILABLE';
}

/** Códigos de error que el módulo nativo usa al rechazar. */
export type DeviceKeyErrorCode =
  | 'CANCELLED' // el usuario canceló el diálogo biométrico
  | 'KEY_INVALIDATED' // se agregó o quitó una huella/rostro: la llave dejó de ser válida
  | 'NO_KEY' // no hay llave con ese alias
  | 'LOCKOUT' // demasiados intentos fallidos
  | 'FAILED';
