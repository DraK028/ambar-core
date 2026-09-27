import { NativeModule, requireNativeModule } from 'expo';
import type { Availability, BiometricPrompt } from './types';

/**
 * Llave ECDSA P-256 en hardware (Android Keystore / Secure Enclave) que solo firma
 * después de una verificación biométrica. La llave privada nunca sale del chip.
 */
declare class DeviceKeyModule extends NativeModule<Record<string, never>> {
  getAvailabilityAsync(): Promise<Availability>;
  hasKeyAsync(alias: string): Promise<boolean>;
  /** Crea (o reemplaza) la llave y devuelve la llave pública en SPKI DER base64. */
  createKeyAsync(alias: string): Promise<string>;
  /** Pide biometría y firma el texto (UTF-8) con SHA256withECDSA. Devuelve la firma DER en base64. */
  signAsync(alias: string, payload: string, prompt: BiometricPrompt): Promise<string>;
  deleteKeyAsync(alias: string): Promise<void>;
}

export default requireNativeModule<DeviceKeyModule>('DeviceKey');
