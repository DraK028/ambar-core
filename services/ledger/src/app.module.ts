import { DynamicModule, Module, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { Pool } from 'pg';
import { AccountsService } from './application/accounts.service';
import { DevicesService } from './application/devices.service';
import { FraudService } from './application/fraud.service';
import { NotificationsService } from './application/notifications.service';
import { STEP_UP_POLICY, StepUpService, type StepUpPolicy } from './application/step-up.service';
import { LedgerService } from './application/ledger.service';
import { ReconciliationService } from './application/reconciliation.service';
import { APP_CONFIG, AppConfig } from './config';
import { PG_POOL } from './infrastructure/db';
import { AuthGuard } from './http/auth.guard';
import {
  AccountsController,
  AdminAccountsController,
  DevicesController,
  EntriesController,
  FraudCasesController,
  HealthController,
  InternalController,
  NotificationsController,
  QaController,
  StepUpController,
  TransfersController,
} from './http/controllers';
import { ProblemFilter } from './http/problem.filter';
import { TokenVerifier } from './http/token-verifier';

@Module({})
export class AppModule {
  /** El pool se recibe desde fuera para que main.ts y las pruebas controlen su ciclo de vida. */
  static register(config: AppConfig, pool: Pool): DynamicModule {
    const controllers: Type<unknown>[] = [
      HealthController,
      AccountsController,
      TransfersController,
      EntriesController,
      DevicesController,
      StepUpController,
      NotificationsController,
      FraudCasesController,
      AdminAccountsController,
      InternalController,
    ];
    const stepUpPolicy: StepUpPolicy = {
      threshold: config.STEP_UP_THRESHOLD,
      clientIds: new Set(config.STEP_UP_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean)),
    };
    if (config.ENABLE_QA_ENDPOINTS) controllers.push(QaController);

    return {
      module: AppModule,
      controllers,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PG_POOL, useValue: pool },
        { provide: STEP_UP_POLICY, useValue: stepUpPolicy },
        TokenVerifier,
        AccountsService,
        DevicesService,
        StepUpService,
        LedgerService,
        NotificationsService,
        FraudService,
        ReconciliationService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
