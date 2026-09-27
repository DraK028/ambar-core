import type { Account, Movement, Notification } from '@ambar/api-client';
import type { CoreApi } from '../../src/tools/core-api';

/** Core en memoria con datos realistas (UUID, CLABE completas) para comprobar que no se filtran. */
export const ACCOUNTS: Account[] = [
  {
    id: '5f0d7c7e-3a52-4b8e-9d57-3f2b1a9c0e11',
    clabe: '999180000000000015',
    currency: 'MXN',
    status: 'ACTIVE',
    balance: 1_234_567,
    created_at: '2026-01-15T16:00:00.000Z',
  },
  {
    id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    clabe: '999180000000000028',
    currency: 'MXN',
    status: 'FROZEN',
    balance: 50_000,
    created_at: '2026-03-01T16:00:00.000Z',
  },
];

let seq = 1000;
export function movement(amount: number, description: string, created_at: string, kind: Movement['kind'] = 'TRANSFER'): Movement {
  seq += 1;
  return { id: String(seq), entry_id: `0000${seq}-aaaa-4bbb-8ccc-dddddddddddd`.slice(-36), kind, description, amount, created_at };
}

export class FakeCore implements CoreApi {
  calls: string[] = [];
  accounts = ACCOUNTS;
  movements: Movement[] = [
    movement(-45_000, 'Súper', '2026-09-25T20:00:00.000Z'),
    movement(-120_000, 'Renta', '2026-09-05T15:00:00.000Z'),
    movement(2_500_000, 'Nómina', '2026-09-01T15:00:00.000Z', 'DEPOSIT'),
    movement(-9_900, 'Café', '2026-08-30T15:00:00.000Z'),
  ];
  notifications: Notification[] = [];
  failWith: Error | null = null;

  async listAccounts(): Promise<Account[]> {
    this.calls.push('GET /v1/accounts');
    if (this.failWith) throw this.failWith;
    return this.accounts;
  }

  async listMovements(accountId: string, opts: { limit?: number; cursor?: string } = {}) {
    this.calls.push(`GET /v1/accounts/${accountId}/movements`);
    if (this.failWith) throw this.failWith;
    // Como el core: del más nuevo al más viejo, con cursor opaco.
    const sorted = [...this.movements].sort((a, b) => b.created_at.localeCompare(a.created_at) || Number(b.id) - Number(a.id));
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 100;
    const page = sorted.slice(start, start + limit);
    return { data: page, next_cursor: start + limit < sorted.length ? String(start + limit) : null };
  }

  async inbox() {
    this.calls.push('GET /v1/notifications');
    return { data: this.notifications, unread_count: this.notifications.filter((n) => !n.read_at).length };
  }
}
