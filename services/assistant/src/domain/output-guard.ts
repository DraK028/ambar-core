import { redact, type RedactionCounts } from './redaction';

/**
 * Revisión determinista de la respuesta del modelo antes de mostrarla. Cubre los daños que
 * un prompt injection (p. ej. en el concepto de una transferencia recibida) podría intentar:
 *   - pedirle al cliente su NIP, CVV, contraseña o códigos → se reemplaza la respuesta completa;
 *   - llevarlo a un sitio externo → los enlaces fuera de los dominios de Ámbar se quitan;
 *   - filtrar datos sensibles → se redactan igual que la entrada.
 */
export interface GuardedOutput {
  text: string;
  redactions: RedactionCounts;
  /** Qué reglas cambiaron la respuesta (para auditoría). */
  actions: Array<'CREDENTIAL_REQUEST' | 'EXTERNAL_LINK' | 'PII'>;
}

const ASKS_FOR_SECRET =
  /\b(comparte|compárteme|envía|enviame|envíame|mándame|mandame|dime|dame|escribe|escríbeme|proporciona|proporcióname|ingresa|confirma|indícame|indicame)\b[^.!?\n]{0,60}\b(nip|pin|cvv|cvc|contraseñas?|password|código|codigo|token|clave|número de (?:tu )?tarjeta|numero de (?:tu )?tarjeta)\b/gi;
/** "Nunca compartas…", "no me des…": advertir no es pedir. */
const NEGATED = /\b(no|nunca|jamás|jamas|ni)\s+(?:\S+\s+){0,2}$/i;

function asksForSecret(text: string): boolean {
  for (const m of text.matchAll(ASKS_FOR_SECRET)) {
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    if (!NEGATED.test(before)) return true;
  }
  return false;
}

const URL = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi;
const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*ambar\.example$/i;

export const SAFE_CREDENTIAL_REPLY =
  'Ámbar nunca te pedirá tu NIP, CVV, contraseñas ni códigos, ni por el asistente ni por teléfono. ' +
  'Si alguien te los pide, no los compartas y revisa tus avisos en la app.';

function hostOf(raw: string): string | null {
  try {
    return new globalThis.URL(raw.startsWith('www.') ? `https://${raw}` : raw).hostname;
  } catch {
    return null;
  }
}

export function guardOutput(text: string): GuardedOutput {
  const actions: GuardedOutput['actions'] = [];
  if (asksForSecret(text)) {
    return { text: SAFE_CREDENTIAL_REPLY, redactions: {}, actions: ['CREDENTIAL_REQUEST'] };
  }
  const withoutLinks = text.replace(URL, (match) => {
    const trailing = /[.,;:!?]+$/.exec(match)?.[0] ?? '';
    const raw = match.slice(0, match.length - trailing.length);
    const host = hostOf(raw);
    if (host && ALLOWED_HOST.test(host)) return match;
    if (!actions.includes('EXTERNAL_LINK')) actions.push('EXTERNAL_LINK');
    return `[enlace eliminado]${trailing}`;
  });
  const r = redact(withoutLinks);
  if (Object.keys(r.found).length) actions.push('PII');
  return { text: r.text, redactions: r.found, actions };
}

/**
 * Texto escrito por terceros (conceptos, avisos) que parece un ataque: pide credenciales o
 * trae enlaces externos. Se oculta ANTES de llegar al modelo, así la instrucción ni siquiera
 * entra al contexto; la revisión de la salida queda como segunda barrera.
 */
export const HIDDEN_CONCEPT = '[concepto oculto por seguridad]';

export function looksLikeAttack(text: string): boolean {
  if (asksForSecret(text)) return true;
  for (const match of text.matchAll(URL)) {
    const host = hostOf(match[0].replace(/[.,;:!?]+$/, ''));
    if (!host || !ALLOWED_HOST.test(host)) return true;
  }
  return false;
}
