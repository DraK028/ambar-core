import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pkcePair, seal, unseal } from './crypto';

const SECRET = 's'.repeat(40);

describe('sellado AES-GCM', () => {
  it('ida y vuelta', () => {
    const value = { state: 'abc', n: 1 };
    expect(unseal(seal(value, SECRET), SECRET)).toEqual(value);
  });

  it('dos sellados del mismo valor son distintos (IV aleatorio)', () => {
    expect(seal({ a: 1 }, SECRET)).not.toBe(seal({ a: 1 }, SECRET));
  });

  it('detecta alteraciones y llaves distintas', () => {
    const sealed = seal({ a: 1 }, SECRET);
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(unseal(tampered, SECRET)).toBeNull();
    expect(unseal(sealed, 'otro-secreto-de-cuarenta-caracteres-xxxx')).toBeNull();
    expect(unseal('basura', SECRET)).toBeNull();
  });
});

describe('PKCE', () => {
  it('el challenge es SHA-256 del verifier en base64url', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});
