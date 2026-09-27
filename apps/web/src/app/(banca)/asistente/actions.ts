'use server';

import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { AssistantProblem, askAssistant, deleteConversation } from '@/lib/assistant';
import { EMPTY_CHAT, type ChatState } from './types';

const Input = z.object({
  message: z.string().trim().min(1).max(1000),
  conversationId: z.string().uuid().optional().or(z.literal('')),
});

const ERRORS: Record<string, string> = {
  RATE_LIMITED: 'Llegaste al límite diario de mensajes del asistente. Vuelve mañana.',
  CONVERSATION_FULL: 'Esta conversación ya es muy larga. Empieza una nueva.',
  CONVERSATION_BUSY: 'Espera la respuesta anterior antes de enviar otro mensaje.',
  NOT_FOUND: 'La conversación venció. Empieza una nueva.',
  ASSISTANT_UNAVAILABLE: 'El asistente no está disponible en este momento. Tus cuentas no se ven afectadas.',
};

export async function askAction(prev: ChatState, form: FormData): Promise<ChatState> {
  const parsed = Input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ...prev, error: 'Escribe una pregunta de hasta 1000 caracteres.' };
  const { message } = parsed.data;
  const conversationId = parsed.data.conversationId || undefined;
  try {
    const r = await askAssistant(message, conversationId);
    return {
      conversationId: r.conversation_id,
      error: null,
      messages: [
        ...prev.messages,
        // Se muestra el mensaje tal como se guardó (sin datos sensibles) solo si el servidor lo redactó.
        { role: 'user', text: message, notices: r.notices },
        { role: 'assistant', text: r.reply.text, tools: r.tools_used },
      ],
    };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AssistantProblem) {
      const expired = err.code === 'NOT_FOUND' || err.code === 'CONVERSATION_FULL';
      return { ...(expired ? EMPTY_CHAT : prev), error: ERRORS[err.code] ?? 'No pudimos obtener una respuesta. Intenta de nuevo.' };
    }
    console.error('Asistente', err instanceof Error ? err.message : err);
    return { ...prev, error: 'No pudimos obtener una respuesta. Intenta de nuevo.' };
  }
}

export async function clearAction(prev: ChatState): Promise<ChatState> {
  if (prev.conversationId) {
    try {
      await deleteConversation(prev.conversationId);
    } catch (err) {
      unstable_rethrow(err);
    }
  }
  return EMPTY_CHAT;
}
