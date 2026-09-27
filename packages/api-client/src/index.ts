import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };

export type Account = components['schemas']['Account'];
export type Movement = components['schemas']['Movement'];
export type MovementPage = components['schemas']['MovementPage'];
export type Transfer = components['schemas']['Transfer'];
export type TransferRequest = components['schemas']['TransferRequest'];
export type Entry = components['schemas']['Entry'];
export type Problem = components['schemas']['Problem'];

export type AmbarClient = Client<paths>;

/**
 * Cliente tipado: rutas, parámetros, cuerpos y respuestas vienen del contrato.
 * Si el contrato cambia y el código no, la compilación falla.
 */
export function createAmbarClient(baseUrl: string, accessToken: string, fetchImpl?: typeof fetch): AmbarClient {
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
    fetch: fetchImpl,
  });
}

export type Device = components['schemas']['Device'];
export type DeviceRegistration = components['schemas']['DeviceRegistration'];
export type TransferOperation = components['schemas']['TransferOperation'];
export type StepUpChallenge = components['schemas']['StepUpChallenge'];
export type Notification = components['schemas']['Notification'];
export type NotificationKind = components['schemas']['NotificationKind'];
export type NotificationInbox = components['schemas']['NotificationInbox'];
export type FraudCase = components['schemas']['FraudCase'];
export type FraudCaseResolution = components['schemas']['FraudCaseResolution'];
export type RiskReason = components['schemas']['RiskReason'];
export type AssistantReply = components['schemas']['AssistantReply'];
export type AssistantConversation = components['schemas']['AssistantConversation'];
