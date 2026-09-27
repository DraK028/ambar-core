import 'server-only';
import { redirect } from 'next/navigation';
import { createAmbarClient, type AssistantReply, type Problem } from '@ambar/api-client';
import { config } from './config';
import { getSession } from './session/session';

/** Acceso al asistente desde el BFF: el navegador nunca ve el token, igual que con el core. */
export class AssistantProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function client() {
  const session = await getSession();
  if (!session) redirect('/entrar?motivo=expirada');
  const c = config();
  return createAmbarClient(c.ASSISTANT_API_URL ?? c.LEDGER_API_URL, session.accessToken, (input, init) =>
    // El modelo puede tardar: hasta 30 s (el límite de API Gateway).
    fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(30_000) }),
  );
}

export async function askAssistant(message: string, conversationId?: string): Promise<AssistantReply> {
  const api = await client();
  const res = await api.POST('/v1/assistant/messages', { body: { message, ...(conversationId ? { conversation_id: conversationId } : {}) } });
  if (res.data) return res.data;
  if (res.response.status === 401) redirect('/entrar?motivo=expirada');
  const p = (res.error ?? {}) as Partial<Problem>;
  throw new AssistantProblem(res.response.status, p.code ?? `HTTP_${res.response.status}`);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const api = await client();
  await api.DELETE('/v1/assistant/conversations/{conversationId}', { params: { path: { conversationId } } });
}
