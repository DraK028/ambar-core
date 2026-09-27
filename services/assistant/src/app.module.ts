import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AssistantService, type AssistantDeps } from './application/assistant.service';
import { APP_CONFIG, AppConfig } from './config';
import { AuthGuard } from './http/auth.guard';
import { AssistantController, HealthController } from './http/controllers';
import { ProblemFilter } from './http/problem.filter';
import { TokenVerifier } from './http/token-verifier';

@Module({})
export class AppModule {
  /** Las dependencias (modelo, almacén, core) llegan desde fuera: main.ts y las pruebas las eligen. */
  static register(config: AppConfig, deps: AssistantDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AssistantController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: AssistantService, useValue: new AssistantService(deps) },
        TokenVerifier,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
