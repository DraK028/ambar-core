import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { AccountsService } from '../application/accounts.service';
import { DevicesService } from '../application/devices.service';
import { FraudService } from '../application/fraud.service';
import { NotificationsService } from '../application/notifications.service';
import { ReconciliationService } from '../application/reconciliation.service';
import { StepUpService } from '../application/step-up.service';
import { LedgerService } from '../application/ledger.service';
import { PG_POOL } from '../infrastructure/db';
import { CurrentUser, Public, RequireScopes } from './auth.guard';
import type { Principal } from './token-verifier';
import {
  DepositBody,
  DeviceRegistrationBody,
  FraudAnswerBody,
  IdempotencyKey,
  InternalFraudCaseBody,
  InternalNotificationBody,
  PushTokenBody,
  UnfreezeBody,
  StepUpChallengeBody,
  StepUpProof,
  MovementsQuery,
  ReversalBody,
  TransferBody,
  UuidParam,
  ZodPipe,
} from './validation';

function replayHeader(res: Response, replayed: boolean): void {
  res.setHeader('Idempotent-Replayed', replayed ? 'true' : 'false');
}

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  @Public()
  async health() {
    await this.pool.query('SELECT 1');
    return { status: 'ok', database: 'ok' };
  }
}

@Controller('v1/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequireScopes('accounts.read')
  async list(@CurrentUser() user: Principal) {
    return { data: await this.accounts.listForOwner(user.sub) };
  }

  @Post()
  @HttpCode(201)
  @RequireScopes('accounts.write')
  open(@CurrentUser() user: Principal) {
    return this.accounts.open(user.sub);
  }

  @Get(':accountId')
  @RequireScopes('accounts.read')
  get(@CurrentUser() user: Principal, @Param('accountId', UuidParam) accountId: string) {
    return this.accounts.getForOwner(accountId, user.sub);
  }

  @Get(':accountId/movements')
  @RequireScopes('accounts.read')
  movements(
    @CurrentUser() user: Principal,
    @Param('accountId', UuidParam) accountId: string,
    @Query(new ZodPipe(MovementsQuery, 'query')) query: z.infer<typeof MovementsQuery>,
  ) {
    return this.accounts.movements(accountId, user.sub, query.limit, query.cursor);
  }
}

@Controller('v1/transfers')
export class TransfersController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  @HttpCode(201)
  @RequireScopes('transfers.write')
  async create(
    @CurrentUser() user: Principal,
    @IdempotencyKey() key: string,
    @StepUpProof() stepUpProof: string | undefined,
    @Body(new ZodPipe(TransferBody)) body: z.infer<typeof TransferBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ledger.transfer({
      userId: user.sub,
      clientId: user.clientId,
      stepUpProof,
      idempotencyKey: key,
      sourceAccountId: body.source_account_id,
      destinationClabe: body.destination_clabe,
      amount: body.amount,
      concept: body.concept,
    });
    replayHeader(res, result.replayed);
    return result.value;
  }
}

@Controller('v1/entries')
export class EntriesController {
  constructor(private readonly ledger: LedgerService) {}

  @Get(':entryId')
  @RequireScopes('ledger.admin')
  get(@Param('entryId', UuidParam) entryId: string) {
    return this.ledger.getEntry(entryId);
  }

  @Post(':entryId/reversals')
  @HttpCode(201)
  @RequireScopes('ledger.admin')
  async reverse(
    @CurrentUser() user: Principal,
    @Param('entryId', UuidParam) entryId: string,
    @IdempotencyKey() key: string,
    @Body(new ZodPipe(ReversalBody)) body: z.infer<typeof ReversalBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ledger.reverse({ actor: user.sub, idempotencyKey: key, entryId, reason: body.reason });
    replayHeader(res, result.replayed);
    return result.value;
  }
}

/** Solo se registra cuando ENABLE_QA_ENDPOINTS=true (nunca en producción). */
@Controller('v1/qa')
export class QaController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('deposits')
  @HttpCode(201)
  @RequireScopes('qa.write')
  async deposit(
    @IdempotencyKey() key: string,
    @Body(new ZodPipe(DepositBody)) body: z.infer<typeof DepositBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ledger.deposit({
      idempotencyKey: key,
      accountId: body.account_id,
      amount: body.amount,
      concept: body.concept,
    });
    replayHeader(res, result.replayed);
    return result.value;
  }
}

@Controller('v1/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequireScopes('devices.write')
  async list(@CurrentUser() user: Principal) {
    return { data: await this.devices.list(user.sub) };
  }

  @Post()
  @HttpCode(201)
  @RequireScopes('devices.write')
  register(@CurrentUser() user: Principal, @Body(new ZodPipe(DeviceRegistrationBody)) body: z.infer<typeof DeviceRegistrationBody>) {
    return this.devices.register(user.sub, { publicKey: body.public_key, platform: body.platform, name: body.name });
  }

  @Delete(':deviceId')
  @HttpCode(204)
  @RequireScopes('devices.write')
  async revoke(@CurrentUser() user: Principal, @Param('deviceId', UuidParam) deviceId: string) {
    await this.devices.revoke(user.sub, deviceId);
  }

  @Put(':deviceId/push-token')
  @HttpCode(204)
  @RequireScopes('devices.write')
  async pushToken(
    @CurrentUser() user: Principal,
    @Param('deviceId', UuidParam) deviceId: string,
    @Body(new ZodPipe(PushTokenBody)) body: z.infer<typeof PushTokenBody>,
  ) {
    await this.devices.setPushToken(user.sub, deviceId, body.push_token);
  }
}

@Controller('v1/step-up/challenges')
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Post()
  @HttpCode(201)
  @RequireScopes('transfers.write')
  create(@CurrentUser() user: Principal, @Body(new ZodPipe(StepUpChallengeBody)) body: z.infer<typeof StepUpChallengeBody>) {
    return this.stepUp.createChallenge(user.sub, body.device_id, body.operation);
  }
}

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequireScopes('accounts.read')
  list(@CurrentUser() user: Principal) {
    return this.notifications.inbox(user.sub);
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  @RequireScopes('accounts.write')
  async read(@CurrentUser() user: Principal, @Param('notificationId', UuidParam) id: string) {
    await this.notifications.markRead(user.sub, id);
  }
}

@Controller('v1/fraud-cases')
export class FraudCasesController {
  constructor(private readonly fraud: FraudService) {}

  @Get(':caseId')
  @RequireScopes('accounts.read')
  get(@CurrentUser() user: Principal, @Param('caseId', UuidParam) id: string) {
    return this.fraud.getForOwner(user.sub, id);
  }

  @Post(':caseId/answer')
  @HttpCode(200)
  @RequireScopes('transfers.write')
  answer(
    @CurrentUser() user: Principal,
    @Param('caseId', UuidParam) id: string,
    @Body(new ZodPipe(FraudAnswerBody)) body: z.infer<typeof FraudAnswerBody>,
  ) {
    return this.fraud.answer(user.sub, id, body.recognized);
  }
}

@Controller('v1/admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post(':accountId/unfreeze')
  @HttpCode(200)
  @RequireScopes('ledger.admin')
  unfreeze(
    @CurrentUser() user: Principal,
    @Param('accountId', UuidParam) accountId: string,
    @Body(new ZodPipe(UnfreezeBody)) body: z.infer<typeof UnfreezeBody>,
  ) {
    return this.accounts.unfreeze(user.sub, accountId, body.reason);
  }
}

/**
 * API interna para n8n. No se publica en API Gateway: n8n la llama dentro de la VPC
 * con un token client_credentials de Cognito (clientes en INTERNAL_CLIENT_IDS).
 */
@Controller('v1/internal')
export class InternalController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly fraud: FraudService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Post('notifications')
  @RequireScopes('internal.notify')
  async notify(
    @Body(new ZodPipe(InternalNotificationBody)) body: z.infer<typeof InternalNotificationBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.notifications.createInternal({
      eventId: body.event_id,
      kind: body.kind,
      ownerId: body.owner_id,
      accountId: body.account_id,
      title: body.title,
      body: body.body,
      data: body.data,
    });
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Post('fraud-cases')
  @RequireScopes('internal.fraud')
  async openCase(
    @Body(new ZodPipe(InternalFraudCaseBody)) body: z.infer<typeof InternalFraudCaseBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.fraud.open(body.entry_id);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Get('reconciliation')
  @RequireScopes('internal.reconcile')
  reconcile() {
    return this.reconciliation.fullReport();
  }
}
