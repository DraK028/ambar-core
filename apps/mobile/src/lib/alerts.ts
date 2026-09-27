import type { Notification, RiskReason } from '@ambar/api-client';

/** Texto para el cliente de cada señal de riesgo (el puntaje nunca se muestra). */
export const REASON_TEXT: Record<RiskReason, string> = {
  NEW_BENEFICIARY: 'Es la primera vez que envías dinero a esta cuenta.',
  UNUSUAL_AMOUNT: 'El monto es mucho mayor que tus transferencias habituales.',
  NIGHT_TIME: 'Se hizo de madrugada.',
  HIGH_VELOCITY: 'Hiciste varias transferencias en pocos minutos.',
};

export const KIND_LABEL: Record<Notification['kind'], string> = {
  WELCOME: 'Bienvenida',
  TRANSFER_SENT: 'Transferencia',
  TRANSFER_RECEIVED: 'Transferencia',
  DEPOSIT_RECEIVED: 'Depósito',
  FRAUD_CHECK: 'Seguridad',
  ACCOUNT_FROZEN: 'Seguridad',
  SECURITY: 'Seguridad',
};

/** Avisos que piden una acción: se destacan en la bandeja. */
export function needsAction(n: Pick<Notification, 'kind' | 'read_at'>): boolean {
  return n.kind === 'FRAUD_CHECK' && n.read_at === null;
}

/**
 * A dónde lleva un aviso (al tocarlo en la bandeja o en el push).
 * Solo se aceptan ids con forma de UUID: el payload de un push no se usa para armar rutas arbitrarias.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlertRoute = { pathname: '/caso/[id]'; params: { id: string } } | { pathname: '/avisos' };

export function routeFor(data: { kind?: unknown; fraud_case_id?: unknown } | null | undefined): AlertRoute {
  if (data?.kind === 'FRAUD_CHECK' && typeof data.fraud_case_id === 'string' && UUID.test(data.fraud_case_id)) {
    return { pathname: '/caso/[id]', params: { id: data.fraud_case_id } };
  }
  return { pathname: '/avisos' };
}

export function unreadBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? '9+' : String(count);
}

/** Aviso entre pantallas: la bandeja cambió (se leyó un aviso), recalcular la insignia. */
const listeners = new Set<() => void>();
export const inboxEvents = {
  emit(): void {
    listeners.forEach((l) => l());
  },
  on(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
