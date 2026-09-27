import { createHash } from 'node:crypto';

/**
 * JSON canónico: llaves ordenadas en todos los niveles, sin espacios.
 * Dos cuerpos equivalentes con distinto orden de llaves producen el mismo hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Huella de una solicitud para detectar reuso de Idempotency-Key con otro cuerpo. */
export function requestHash(operation: string, body: unknown): string {
  return createHash('sha256').update(`${operation}\n${canonicalJson(body)}`).digest('hex');
}
