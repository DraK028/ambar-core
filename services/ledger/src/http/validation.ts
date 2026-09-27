import { ExecutionContext, PipeTransform, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodTypeAny } from 'zod';
import { MAX_OPERATION_AMOUNT } from '../domain/money';
import { ValidationError } from '../domain/errors';
import { NOTIFICATION_KINDS } from '../application/notifications.service';

/** Valida y transforma con un esquema zod; los errores salen como VALIDATION_ERROR con detalle por campo. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T, private readonly where = 'body') {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError(
        `El ${this.where} no cumple el contrato.`,
        parsed.error.issues.map((i) => ({ path: i.path.join('.') || this.where, message: i.message })),
      );
    }
    return parsed.data;
  }
}

const uuid = z.string().uuid();
const clabe = z.string().regex(/^\d{18}$/, 'debe tener 18 dígitos');
const amount = z.number().int('debe ser un entero en centavos').min(1).max(MAX_OPERATION_AMOUNT);
const concept = z.string().trim().min(1).max(40);

export const UuidParam = new ZodPipe(uuid, 'parámetro de ruta');

export const TransferBody = z
  .object({
    source_account_id: uuid,
    destination_clabe: clabe,
    amount,
    concept,
  })
  .strict();

export const DepositBody = z.object({ account_id: uuid, amount, concept }).strict();

export const ReversalBody = z.object({ reason: z.string().trim().min(3).max(140) }).strict();

export const MovementsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().regex(/^\d+$/, 'cursor inválido').optional(),
  })
  .strict();

/** Lee y valida el header Idempotency-Key (UUID obligatorio). */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const value = req.header('idempotency-key');
  if (!value || !uuid.safeParse(value).success) {
    throw new ValidationError('El header Idempotency-Key es obligatorio y debe ser un UUID.', [
      { path: 'Idempotency-Key', message: 'UUID requerido' },
    ]);
  }
  return value.toLowerCase();
});

export const DeviceRegistrationBody = z
  .object({
    public_key: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'debe estar en base64').min(80).max(200),
    platform: z.enum(['ios', 'android']),
    name: z.string().trim().min(1).max(60),
  })
  .strict();

export const StepUpChallengeBody = z
  .object({
    device_id: uuid,
    operation: z
      .object({
        type: z.literal('transfer'),
        source_account_id: uuid,
        destination_clabe: clabe,
        amount,
        concept,
      })
      .strict(),
  })
  .strict();

/** X-Step-Up opcional; si viene, debe tener la forma <challenge_id>.<firma base64url>. */
export const StepUpProof = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const value = ctx.switchToHttp().getRequest<Request>().header('x-step-up');
  if (value === undefined) return undefined;
  if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16,200}$/.test(value)) {
    throw new ValidationError('El header X-Step-Up no tiene el formato <challenge_id>.<firma>.', [
      { path: 'X-Step-Up', message: 'formato inválido' },
    ]);
  }
  return value;
});

export const PushTokenBody = z
  .object({
    push_token: z
      .string()
      .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/, 'debe ser un token de Expo Push')
      .nullable(),
  })
  .strict();

export const FraudAnswerBody = z.object({ recognized: z.boolean() }).strict();

export const UnfreezeBody = z.object({ reason: z.string().trim().min(3).max(140) }).strict();

const notificationData = z
  .object({ account_id: uuid.optional(), entry_id: uuid.optional(), fraud_case_id: uuid.optional() })
  .strict();

/** Aviso redactado por n8n. Destinatario: owner_id o account_id (exactamente uno). */
export const InternalNotificationBody = z
  .object({
    event_id: uuid,
    kind: z.enum(NOTIFICATION_KINDS),
    owner_id: z.string().min(1).max(128).optional(),
    account_id: uuid.optional(),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(280),
    data: notificationData.default({}),
  })
  .strict()
  .refine((b) => (b.owner_id === undefined) !== (b.account_id === undefined), {
    message: 'indica owner_id o account_id (solo uno)',
    path: ['owner_id'],
  });

export const InternalFraudCaseBody = z.object({ entry_id: uuid }).strict();
