import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * Dispositivo simulado: genera un par ECDSA P-256 como lo haría Android Keystore o
 * Secure Enclave y firma el signing_payload con SHA256withECDSA (firma DER).
 */
export class FakeDevice {
  private readonly privateKey: KeyObject;
  readonly publicKeyBase64: string;

  constructor(curve: 'prime256v1' | 'secp384r1' = 'prime256v1') {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: curve });
    this.privateKey = privateKey;
    this.publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  }

  sign(payload: string): string {
    return sign('sha256', Buffer.from(payload, 'utf8'), { key: this.privateKey, dsaEncoding: 'der' }).toString('base64url');
  }

  proof(challenge: { id: string; signing_payload: string }): string {
    return `${challenge.id}.${this.sign(challenge.signing_payload)}`;
  }
}
