'use strict';
/**
 * Contrato de eventos del core Ámbar.
 *
 * El relay del outbox publica cada evento en EventBridge con este sobre (detail) y, en local,
 * lo manda directo a n8n. Hacia n8n siempre viaja firmado con HMAC-SHA256:
 *
 *   Ambar-Signature: t=<unix>,v1=<hex(hmac(secret, t + "." + cuerpo))>
 *
 * El timestamp dentro de la firma impide reenviar un webhook capturado más tarde
 * (tolerancia de 5 minutos). Se aceptan varias firmas v1 para rotar el secreto sin corte.
 *
 * JavaScript plano (CommonJS) a propósito: lo usan el Ledger (Nest), la Lambda (esbuild)
 * y las pruebas sin paso de compilación.
 */
const { createHmac, timingSafeEqual } = require('node:crypto');

const SOURCE = 'ambar.core';
const SIGNATURE_HEADER = 'ambar-signature';
const EVENT_ID_HEADER = 'ambar-event-id';
const EVENT_TYPE_HEADER = 'ambar-event-type';
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Qué flujos de n8n reciben cada tipo de evento (ruta /webhook/<nombre>). */
const ROUTES = Object.freeze({
  'account.opened': ['onboarding'],
  'transfer.posted': ['movimientos', 'alerta-fraude'],
  'deposit.posted': ['movimientos'],
  'fraud_case.answered': ['fraude-respuesta'],
});

const EVENT_TYPES = Object.freeze([
  'account.opened',
  'account.frozen',
  'account.unfrozen',
  'transfer.posted',
  'deposit.posted',
  'entry.reversed',
  'device.registered',
  'device.revoked',
  'fraud_case.answered',
]);

function routesFor(type) {
  return ROUTES[type] || [];
}

/** Fila del outbox → sobre del evento. */
function toEnvelope(row) {
  const occurred = row.payload && typeof row.payload.occurred_at === 'string' ? row.payload.occurred_at : null;
  return {
    id: row.id,
    type: row.event_type,
    source: SOURCE,
    version: 1,
    occurred_at: occurred || new Date(row.created_at).toISOString(),
    aggregate_id: row.aggregate_id,
    data: row.payload,
  };
}

function hmacHex(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Encabezado de firma para un cuerpo ya serializado. */
function sign(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('Falta el secreto de firma de webhooks.');
  return `t=${timestamp},v1=${hmacHex(secret, timestamp, rawBody)}`;
}

function parseSignature(header) {
  const out = { t: NaN, v1: [] };
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') out.t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) out.v1.push(v);
  }
  return out;
}

/**
 * Verifica la firma. `secrets` puede ser uno o varios (rotación).
 * Devuelve { ok: true } o { ok: false, reason }.
 */
function verify(rawBody, header, secrets, opts = {}) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (list.length === 0) return { ok: false, reason: 'NO_SECRET' };
  const sig = parseSignature(header);
  if (!Number.isInteger(sig.t) || sig.v1.length === 0) return { ok: false, reason: 'MALFORMED' };
  if (Math.abs(now - sig.t) > tolerance) return { ok: false, reason: 'EXPIRED' };
  for (const secret of list) {
    const expected = Buffer.from(hmacHex(secret, sig.t, rawBody), 'hex');
    for (const candidate of sig.v1) {
      const given = Buffer.from(candidate, 'hex');
      if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
    }
  }
  return { ok: false, reason: 'MISMATCH' };
}

/** Encabezados para POSTear un evento a un webhook. */
function webhookHeaders(envelope, rawBody, secret, timestamp) {
  return {
    'content-type': 'application/json',
    [SIGNATURE_HEADER]: sign(rawBody, secret, timestamp),
    [EVENT_ID_HEADER]: envelope.id,
    [EVENT_TYPE_HEADER]: envelope.type,
  };
}

module.exports = {
  SOURCE,
  SIGNATURE_HEADER,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  DEFAULT_TOLERANCE_SECONDS,
  ROUTES,
  EVENT_TYPES,
  routesFor,
  toEnvelope,
  sign,
  verify,
  parseSignature,
  webhookHeaders,
};
