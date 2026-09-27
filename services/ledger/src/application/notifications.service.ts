import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { NotFoundError } from '../domain/errors';
import { PG_POOL } from '../infrastructure/db';
import { findAccountById, type Queryable } from '../infrastructure/queries';

export const NOTIFICATION_KINDS = [
  'WELCOME',
  'TRANSFER_SENT',
  'TRANSFER_RECEIVED',
  'DEPOSIT_RECEIVED',
  'FRAUD_CHECK',
  'ACCOUNT_FROZEN',
  'SECURITY',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Referencias que la app usa para navegar desde el aviso. Nunca datos personales. */
export interface NotificationData {
  account_id?: string;
  entry_id?: string;
  fraud_case_id?: string;
}

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: NotificationData;
  created_at: string;
  read_at: string | null;
}

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: NotificationData;
  created_at: Date;
  read_at: Date | null;
}

const COLUMNS = 'id, kind, title, body, data, created_at, read_at';
export const INBOX_SIZE = 50;

function toView(r: NotificationRow): NotificationView {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    data: r.data,
    created_at: r.created_at.toISOString(),
    read_at: r.read_at ? r.read_at.toISOString() : null,
  };
}

export interface NewNotification {
  eventId: string;
  kind: NotificationKind;
  ownerId: string;
  title: string;
  body: string;
  data?: NotificationData;
}

/**
 * Inserta el aviso una sola vez por (evento, usuario, tipo). Si ya existía, devuelve el original:
 * n8n puede reintentar un flujo sin duplicar avisos ni pushes.
 */
export async function insertNotification(q: Queryable, n: NewNotification): Promise<{ notification: NotificationView; created: boolean }> {
  const inserted = await q.query<NotificationRow>(
    `INSERT INTO customer.notifications (owner_id, kind, title, body, data, source_event_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ON CONSTRAINT notifications_once_per_event DO NOTHING
     RETURNING ${COLUMNS}`,
    [n.ownerId, n.kind, n.title, n.body, n.data ?? {}, n.eventId],
  );
  if (inserted.rows[0]) return { notification: toView(inserted.rows[0]), created: true };
  const { rows } = await q.query<NotificationRow>(
    `SELECT ${COLUMNS} FROM customer.notifications WHERE source_event_id = $1 AND owner_id = $2 AND kind = $3`,
    [n.eventId, n.ownerId, n.kind],
  );
  return { notification: toView(rows[0]), created: false };
}

/** Tokens de Expo Push de los dispositivos activos del usuario. */
export async function pushTokensFor(q: Queryable, ownerId: string): Promise<string[]> {
  const { rows } = await q.query<{ push_token: string }>(
    `SELECT push_token FROM identity.devices
      WHERE owner_id = $1 AND status = 'ACTIVE' AND push_token IS NOT NULL
      ORDER BY created_at`,
    [ownerId],
  );
  return rows.map((r) => r.push_token);
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async inbox(ownerId: string): Promise<{ data: NotificationView[]; unread_count: number }> {
    const [list, unread] = await Promise.all([
      this.pool.query<NotificationRow>(
        `SELECT ${COLUMNS} FROM customer.notifications WHERE owner_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [ownerId, INBOX_SIZE],
      ),
      this.pool.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM customer.notifications WHERE owner_id = $1 AND read_at IS NULL',
        [ownerId],
      ),
    ]);
    return { data: list.rows.map(toView), unread_count: unread.rows[0].n };
  }

  async markRead(ownerId: string, id: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE customer.notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    if (res.rowCount === 0) throw new NotFoundError('notification');
  }

  /** API interna (n8n): el destinatario se indica por usuario o por cuenta. */
  async createInternal(input: Omit<NewNotification, 'ownerId'> & { ownerId?: string; accountId?: string }) {
    let ownerId = input.ownerId;
    if (input.accountId) {
      const account = await findAccountById(this.pool, input.accountId);
      if (!account || account.kind !== 'CUSTOMER' || !account.ownerId) throw new NotFoundError('account');
      ownerId = account.ownerId;
    }
    const result = await insertNotification(this.pool, { ...input, ownerId: ownerId! });
    return { ...result, push_tokens: await pushTokensFor(this.pool, ownerId!) };
  }
}
