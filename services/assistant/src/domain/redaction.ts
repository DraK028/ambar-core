/**
 * Minimización de datos: lo que llega al modelo (mensajes del usuario, conceptos de
 * movimientos, avisos) y lo que sale de él pasa por aquí.
 *
 * Se reemplazan por marcadores: tarjetas (Luhn), CLABE (dígito verificador), números largos,
 * teléfonos, CURP, RFC, correos, identificadores internos (UUID) y valores de NIP, CVV
 * o contraseñas escritos en el texto. Las CLABE y tarjetas conservan solo los últimos 4 dígitos.
 *
 * Es una red de seguridad determinista: funciona igual aunque el modelo se equivoque o
 * alguien intente engañarlo, y se complementa con los Guardrails de Bedrock en AWS.
 */
export type PiiKind = 'CARD' | 'CLABE' | 'LONG_NUMBER' | 'PHONE' | 'CURP' | 'RFC' | 'EMAIL' | 'SECRET' | 'ID';

export type RedactionCounts = Partial<Record<PiiKind, number>>;

export interface Redaction {
  text: string;
  found: RedactionCounts;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const STATES = 'AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE';
const DATE = '\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])';
const CURP = new RegExp(`\\b[A-Z][AEIOUX][A-Z]{2}${DATE}[HMX](?:${STATES})[B-DF-HJ-NP-TV-Z]{3}[A-Z\\d]\\d\\b`, 'gi');
const RFC = new RegExp(`\\b[A-ZÑ&]{3,4}${DATE}[A-Z\\d]{3}\\b`, 'gi');
/** "mi NIP es 1234", "contraseña: hola123", "cvv 123" */
const SECRET_WITH_SEPARATOR =
  /\b(nip|pin|cvv|cvc|cvv2|contraseñas?|contrasenas?|password|clave de acceso|código de seguridad|codigo de seguridad|token de seguridad)(\s*(?:es|era|:|=)\s*)(\S+)/gi;
const SECRET_DIGITS = /\b(nip|pin|cvv|cvc|cvv2)(\s+)(\d{3,6})\b/gi;
/** Corridas de 10 a 19 dígitos, con espacios o guiones sueltos entre ellos. */
const DIGIT_RUN = /(?<![\d])\+?\d(?:[ -]?\d){9,18}(?![\d])/g;

export function clabeIsValid(digits: string): boolean {
  if (!/^\d{18}$/.test(digits)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += ((Number(digits[i]) * weights[i % 3]) % 10);
  return (10 - (sum % 10)) % 10 === Number(digits[17]);
}

export function luhnIsValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function classifyDigits(raw: string): { kind: PiiKind; replacement: string } | null {
  const digits = raw.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  if (digits.length === 18 && clabeIsValid(digits)) return { kind: 'CLABE', replacement: `[CLABE ••${last4}]` };
  if (digits.length >= 13 && luhnIsValid(digits)) return { kind: 'CARD', replacement: `[TARJETA ••${last4}]` };
  if (digits.length >= 13) return { kind: 'LONG_NUMBER', replacement: '[NÚMERO OCULTO]' };
  if (digits.length === 10 || (digits.length === 12 && digits.startsWith('52'))) return { kind: 'PHONE', replacement: '[TELÉFONO]' };
  return null;
}

export function redact(input: string): Redaction {
  const found: RedactionCounts = {};
  const count = (kind: PiiKind) => {
    found[kind] = (found[kind] ?? 0) + 1;
  };

  let text = input;
  text = text.replace(UUID, () => {
    count('ID');
    return '[ID]';
  });
  text = text.replace(EMAIL, () => {
    count('EMAIL');
    return '[CORREO]';
  });
  text = text.replace(CURP, () => {
    count('CURP');
    return '[CURP]';
  });
  text = text.replace(RFC, () => {
    count('RFC');
    return '[RFC]';
  });
  text = text.replace(SECRET_WITH_SEPARATOR, (_m, word: string, sep: string) => {
    count('SECRET');
    return `${word}${sep}[SECRETO]`;
  });
  text = text.replace(SECRET_DIGITS, (_m, word: string, sep: string) => {
    count('SECRET');
    return `${word}${sep}[SECRETO]`;
  });
  text = text.replace(DIGIT_RUN, (match) => {
    const c = classifyDigits(match);
    if (!c) return match;
    count(c.kind);
    return c.replacement;
  });
  return { text, found };
}

export function mergeCounts(...all: RedactionCounts[]): RedactionCounts {
  const out: RedactionCounts = {};
  for (const counts of all) {
    for (const [k, v] of Object.entries(counts) as [PiiKind, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** Aviso al usuario cuando su propio mensaje traía datos que no debe compartir. */
export function noticesFor(found: RedactionCounts): string[] {
  const notices: string[] = [];
  if (found.CARD || found.SECRET) {
    notices.push('Quitamos de tu mensaje un número de tarjeta, NIP, CVV o contraseña. Ámbar nunca te los pedirá: no los compartas con nadie, ni con el asistente.');
  }
  if (found.CLABE || found.LONG_NUMBER || found.PHONE || found.CURP || found.RFC || found.EMAIL) {
    notices.push('Ocultamos datos personales de tu mensaje antes de procesarlo.');
  }
  return notices;
}
