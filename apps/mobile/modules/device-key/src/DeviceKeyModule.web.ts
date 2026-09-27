import { NativeModule, registerWebModule } from 'expo';

/** En web no hay llave de hardware: la banca web usa su propio flujo (BFF). */
class DeviceKeyModule extends NativeModule<Record<string, never>> {
  async getAvailabilityAsync() {
    return { available: false, hardwareBacked: false, reason: 'NO_HARDWARE' as const };
  }
  async hasKeyAsync() {
    return false;
  }
  async createKeyAsync(): Promise<string> {
    throw new Error('Llave de dispositivo no disponible en web');
  }
  async signAsync(): Promise<string> {
    throw new Error('Llave de dispositivo no disponible en web');
  }
  async deleteKeyAsync() {}
}

export default registerWebModule(DeviceKeyModule, 'DeviceKey');
