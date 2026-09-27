export type EventType =
  | 'account.opened'
  | 'account.frozen'
  | 'account.unfrozen'
  | 'transfer.posted'
  | 'deposit.posted'
  | 'entry.reversed'
  | 'device.registered'
  | 'device.revoked'
  | 'fraud_case.answered';

export interface EventEnvelope<T = Record<string, unknown>> {
  id: string;
  type: EventType | string;
  source: 'ambar.core';
  version: 1;
  occurred_at: string;
  aggregate_id: string;
  data: T;
}

export interface OutboxRowLike {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'NO_SECRET' | 'MALFORMED' | 'EXPIRED' | 'MISMATCH' };

export declare const SOURCE: 'ambar.core';
export declare const SIGNATURE_HEADER: 'ambar-signature';
export declare const EVENT_ID_HEADER: 'ambar-event-id';
export declare const EVENT_TYPE_HEADER: 'ambar-event-type';
export declare const DEFAULT_TOLERANCE_SECONDS: number;
export declare const ROUTES: Readonly<Record<string, readonly string[]>>;
export declare const EVENT_TYPES: readonly EventType[];

export declare function routesFor(type: string): readonly string[];
export declare function toEnvelope(row: OutboxRowLike): EventEnvelope;
export declare function sign(rawBody: string, secret: string, timestamp?: number): string;
export declare function verify(
  rawBody: string,
  header: string | undefined | null,
  secrets: string | string[],
  opts?: { toleranceSeconds?: number; now?: number },
): VerifyResult;
export declare function parseSignature(header: string | undefined | null): { t: number; v1: string[] };
export declare function webhookHeaders(envelope: EventEnvelope, rawBody: string, secret: string, timestamp?: number): Record<string, string>;
