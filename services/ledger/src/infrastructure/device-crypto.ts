import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { ValidationError } from '../domain/errors';

export interface DevicePublicKey {
  der: Buffer;
  fingerprint: string;
}

function invalid(message: string): never {
  throw new ValidationError(message, [{ path: 'public_key', message }]);
}

/**
 * Acepta solo llaves ECDSA P-256 en SPKI DER (lo que producen Android Keystore y, con el
 * encabezado ASN.1, Secure Enclave). Rechaza RSA, otras curvas y bytes que no sean una llave.
 */
export function parseDevicePublicKey(base64: string): DevicePublicKey {
  let der: Buffer;
  let key: KeyObject;
  try {
    der = Buffer.from(base64, 'base64');
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    invalid('public_key no es una llave pública SPKI DER en base64.');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    invalid('Solo se aceptan llaves ECDSA P-256 generadas en el hardware del dispositivo.');
  }
  // Normaliza: la huella se calcula sobre la codificación canónica, no sobre lo que mandó el cliente.
  const canonical = key.export({ format: 'der', type: 'spki' });
  return { der: canonical, fingerprint: createHash('sha256').update(canonical).digest('hex') };
}

/** SHA256withECDSA con firma DER (formato de Android Signature y de SecKeyCreateSignature X962). */
export function verifyDeviceSignature(publicKeyDer: Buffer, payload: string, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    return verify('sha256', Buffer.from(payload, 'utf8'), { key, dsaEncoding: 'der' }, signature);
  } catch {
    return false;
  }
}
