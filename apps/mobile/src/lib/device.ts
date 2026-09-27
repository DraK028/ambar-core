import DeviceKey from '@modules/device-key';
import type { Signer } from './transfer-flow';

/** Alias de la llave en Keystore / Secure Enclave. Una sola llave por instalación. */
export const DEVICE_KEY_ALIAS = 'ambar-device-key';

export const deviceSigner: Signer = {
  sign: (payload, prompt) => DeviceKey.signAsync(DEVICE_KEY_ALIAS, payload, prompt),
};

export { DeviceKey };
