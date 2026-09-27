import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DeviceLimitReachedError, NotFoundError, ValidationError } from '../domain/errors';
import { PG_POOL, pgError, withTransaction } from '../infrastructure/db';
import { parseDevicePublicKey } from '../infrastructure/device-crypto';

export const MAX_ACTIVE_DEVICES = 3;

export interface DeviceView {
  id: string;
  platform: 'ios' | 'android';
  name: string;
  status: 'ACTIVE' | 'REVOKED';
  created_at: string;
  last_used_at: string | null;
}

interface DeviceRow {
  id: string;
  platform: 'ios' | 'android';
  name: string;
  status: 'ACTIVE' | 'REVOKED';
  created_at: Date;
  last_used_at: Date | null;
}

const COLUMNS = 'id, platform, name, status, created_at, last_used_at';

function toView(r: DeviceRow): DeviceView {
  return {
    id: r.id,
    platform: r.platform,
    name: r.name,
    status: r.status,
    created_at: r.created_at.toISOString(),
    last_used_at: r.last_used_at ? r.last_used_at.toISOString() : null,
  };
}

@Injectable()
export class DevicesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async register(ownerId: string, input: { publicKey: string; platform: 'ios' | 'android'; name: string }): Promise<DeviceView> {
    const key = parseDevicePublicKey(input.publicKey);
    try {
      return await withTransaction(this.pool, async (c) => {
        // Serializa los registros del mismo usuario para que el límite no se rebase con solicitudes en paralelo.
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`devices:${ownerId}`]);
        const { rows: count } = await c.query<{ n: number }>(
          `SELECT COUNT(*)::bigint AS n FROM identity.devices WHERE owner_id = $1 AND status = 'ACTIVE'`,
          [ownerId],
        );
        if (count[0].n >= MAX_ACTIVE_DEVICES) throw new DeviceLimitReachedError(MAX_ACTIVE_DEVICES);

        const { rows } = await c.query<DeviceRow>(
          `INSERT INTO identity.devices (owner_id, platform, name, public_key, key_fingerprint)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${COLUMNS}`,
          [ownerId, input.platform, input.name.trim(), key.der, key.fingerprint],
        );
        await c.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'device.registered', $2)`, [
          rows[0].id,
          { device_id: rows[0].id, owner_id: ownerId, platform: input.platform, occurred_at: new Date().toISOString() },
        ]);
        return toView(rows[0]);
      });
    } catch (err) {
      const { code, constraint } = pgError(err);
      if (code === '23505' && constraint === 'devices_key_fingerprint_key') {
        throw new ValidationError('Esta llave ya está registrada. Genera una llave nueva en el dispositivo.', [
          { path: 'public_key', message: 'llave ya registrada' },
        ]);
      }
      throw err;
    }
  }

  async list(ownerId: string): Promise<DeviceView[]> {
    const { rows } = await this.pool.query<DeviceRow>(
      `SELECT ${COLUMNS} FROM identity.devices WHERE owner_id = $1 ORDER BY created_at DESC`,
      [ownerId],
    );
    return rows.map(toView);
  }

  /** Revocar invalida también los retos pendientes: la verificación exige dispositivo activo. */
  async revoke(ownerId: string, deviceId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE identity.devices SET status = 'REVOKED', revoked_at = now(), push_token = NULL
        WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'`,
      [deviceId, ownerId],
    );
    if (res.rowCount === 0) throw new NotFoundError('device');
    await this.pool.query(`INSERT INTO ledger.outbox (aggregate_id, event_type, payload) VALUES ($1, 'device.revoked', $2)`, [
      deviceId,
      { device_id: deviceId, owner_id: ownerId, occurred_at: new Date().toISOString() },
    ]);
  }

  /** Registra (o borra, con null) el token de Expo Push del dispositivo. Solo dispositivos activos del usuario. */
  async setPushToken(ownerId: string, deviceId: string, pushToken: string | null): Promise<void> {
    const res = await this.pool.query(
      `UPDATE identity.devices SET push_token = $3 WHERE id = $1 AND owner_id = $2 AND status = 'ACTIVE'`,
      [deviceId, ownerId, pushToken],
    );
    if (res.rowCount === 0) throw new NotFoundError('device');
  }
}
