import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { NotFoundError, StepUpRequiredError } from '../domain/errors';
import { CHALLENGE_TTL_MS, parseStepUpProof, signingPayload, stepUpReason } from '../domain/step-up';
import { PG_POOL, withTransaction } from '../infrastructure/db';
import { verifyDeviceSignature } from '../infrastructure/device-crypto';
import { findAccountById } from '../infrastructure/queries';
import { requestHash } from './request-hash';

export const STEP_UP_POLICY = Symbol('STEP_UP_POLICY');

export interface StepUpPolicy {
  /** Monto en centavos a partir del cual se exige firma del dispositivo. */
  threshold: number;
  /** app clients de Cognito a los que aplica (la app móvil). */
  clientIds: ReadonlySet<string>;
}

export interface TransferOperation {
  type: 'transfer';
  source_account_id: string;
  destination_clabe: string;
  amount: number;
  concept: string;
}

export function operationHash(op: TransferOperation): string {
  return requestHash('step-up-operation', op);
}

@Injectable()
export class StepUpService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createChallenge(ownerId: string, deviceId: string, operation: TransferOperation) {
    const account = await findAccountById(this.pool, operation.source_account_id);
    if (!account || account.ownerId !== ownerId) throw new NotFoundError('account');

    const nonce = randomBytes(32).toString('base64url');
    const { rows } = await this.pool.query<{ id: string; expires_at: Date }>(
      `INSERT INTO identity.step_up_challenges (owner_id, device_id, nonce, operation_hash, expires_at)
       SELECT $1, d.id, $3, $4, now() + $5::int * interval '1 millisecond'
         FROM identity.devices d
        WHERE d.id = $2 AND d.owner_id = $1 AND d.status = 'ACTIVE'
       RETURNING id, expires_at`,
      [ownerId, deviceId, nonce, operationHash(operation), CHALLENGE_TTL_MS],
    );
    if (!rows[0]) throw new NotFoundError('device');
    return {
      id: rows[0].id,
      expires_at: rows[0].expires_at.toISOString(),
      signing_payload: signingPayload(rows[0].id, nonce, operationHash(operation)),
    };
  }

  /** ¿Ya transfirió este usuario a esta cuenta antes? */
  async isKnownBeneficiary(ownerId: string, destinationAccountId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM ledger.journal_entries
        WHERE kind = 'TRANSFER'
          AND metadata ->> 'initiated_by' = $1
          AND metadata ->> 'destination_account_id' = $2
        LIMIT 1`,
      [ownerId, destinationAccountId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Decide si la transferencia necesita step-up y, si lo necesita, exige y consume una prueba válida. */
  async enforce(
    policy: StepUpPolicy,
    p: { ownerId: string; clientId: string | null; destinationAccountId: string; operation: TransferOperation; proof?: string },
  ): Promise<void> {
    if (!p.clientId || !policy.clientIds.has(p.clientId)) return;
    const reason = stepUpReason({
      amount: p.operation.amount,
      threshold: policy.threshold,
      knownBeneficiary: await this.isKnownBeneficiary(p.ownerId, p.destinationAccountId),
    });
    if (!reason) return;
    if (!p.proof) throw new StepUpRequiredError(reason, reason === 'AMOUNT_THRESHOLD' ? policy.threshold : undefined);
    await this.consumeProof(p.ownerId, p.proof, p.operation);
  }

  /**
   * Verifica la firma y marca el reto como usado en la misma transacción (FOR UPDATE):
   * dos solicitudes con la misma prueba no pueden pasar ambas.
   */
  async consumeProof(ownerId: string, proofHeader: string, operation: TransferOperation): Promise<void> {
    const proof = parseStepUpProof(proofHeader);
    if (!proof) throw new StepUpRequiredError('INVALID_PROOF');
    const expectedHash = operationHash(operation);

    const ok = await withTransaction(this.pool, async (c) => {
      const { rows } = await c.query<{
        owner_id: string;
        device_id: string;
        nonce: string;
        operation_hash: string;
        expires_at: Date;
        used_at: Date | null;
        public_key: Buffer;
        device_status: string;
        device_owner: string;
      }>(
        `SELECT ch.owner_id, ch.device_id, ch.nonce, ch.operation_hash, ch.expires_at, ch.used_at,
                d.public_key, d.status AS device_status, d.owner_id AS device_owner
           FROM identity.step_up_challenges ch
           JOIN identity.devices d ON d.id = ch.device_id
          WHERE ch.id = $1
          FOR UPDATE OF ch`,
        [proof.challengeId],
      );
      const ch = rows[0];
      const valid =
        !!ch &&
        ch.owner_id === ownerId &&
        ch.device_owner === ownerId &&
        ch.device_status === 'ACTIVE' &&
        ch.used_at === null &&
        ch.expires_at.getTime() > Date.now() &&
        ch.operation_hash === expectedHash &&
        verifyDeviceSignature(ch.public_key, signingPayload(proof.challengeId, ch.nonce, expectedHash), proof.signature);
      if (!valid) return false;

      await c.query('UPDATE identity.step_up_challenges SET used_at = now() WHERE id = $1', [proof.challengeId]);
      await c.query('UPDATE identity.devices SET last_used_at = now() WHERE id = $1', [ch.device_id]);
      return true;
    });
    if (!ok) throw new StepUpRequiredError('INVALID_PROOF');
  }
}
