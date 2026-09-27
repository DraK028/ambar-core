import { generateKeyPairSync } from 'node:crypto';
import { ValidationError } from '../domain/errors';
import { FakeDevice } from '../../test/support/device';
import { parseDevicePublicKey, verifyDeviceSignature } from './device-crypto';

describe('llaves de dispositivo', () => {
  it('acepta P-256 en SPKI y calcula una huella estable', () => {
    const device = new FakeDevice();
    const a = parseDevicePublicKey(device.publicKeyBase64);
    const b = parseDevicePublicKey(device.publicKeyBase64);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('rechaza otras curvas, RSA y bytes que no son una llave', () => {
    expect(() => parseDevicePublicKey(new FakeDevice('secp384r1').publicKeyBase64)).toThrow(ValidationError);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() => parseDevicePublicKey(rsa)).toThrow(/P-256/);
    expect(() => parseDevicePublicKey(Buffer.from('no soy una llave '.repeat(6)).toString('base64'))).toThrow(/SPKI/);
  });

  it('verifica firmas SHA256withECDSA y detecta alteraciones', () => {
    const device = new FakeDevice();
    const { der } = parseDevicePublicKey(device.publicKeyBase64);
    const payload = 'ambar-step-up:v1\nc\nn\nh';
    const signature = Buffer.from(device.sign(payload), 'base64url');

    expect(verifyDeviceSignature(der, payload, signature)).toBe(true);
    expect(verifyDeviceSignature(der, `${payload}x`, signature)).toBe(false);
    expect(verifyDeviceSignature(der, payload, Buffer.from('basura'))).toBe(false);

    const other = parseDevicePublicKey(new FakeDevice().publicKeyBase64);
    expect(verifyDeviceSignature(other.der, payload, signature)).toBe(false);
  });
});
