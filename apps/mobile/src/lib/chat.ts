import type { AssistantReply } from '@ambar/api-client';

/** Estado de la conversación con el asistente (lógica pura, probada sin React Native). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  notices?: string[];
  tools?: string[];
  pending?: boolean;
}

export interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  error: string | null;
}

export const EMPTY_CHAT: ChatState = { conversationId: null, messages: [], error: null };

export const SUGGESTIONS = ['¿Cuál es mi saldo?', '¿En qué gasté este mes?', 'Mis últimos movimientos', '¿Tengo avisos?'];

const TOOL_LABELS: Record<string, string> = {
  consultar_cuentas: 'tus cuentas',
  consultar_movimientos: 'tus movimientos',
  resumen_del_mes: 'el resumen del mes',
  consultar_avisos: 'tus avisos',
};

export function toolsLine(tools: string[] | undefined): string | null {
  if (!tools?.length) return null;
  return `Consulté ${tools.map((t) => TOOL_LABELS[t] ?? t).join(', ')}.`;
}

const ERRORS: Record<string, string> = {
  RATE_LIMITED: 'Llegaste al límite diario de mensajes del asistente. Vuelve mañana.',
  CONVERSATION_FULL: 'Esta conversación ya es muy larga. Empieza una nueva.',
  CONVERSATION_BUSY: 'Espera la respuesta anterior antes de enviar otro mensaje.',
  NOT_FOUND: 'La conversación venció. Empieza una nueva.',
  ASSISTANT_UNAVAILABLE: 'El asistente no está disponible en este momento. Tus cuentas no se ven afectadas.',
  NETWORK: 'Sin conexión con Ámbar. Revisa tu internet e intenta de nuevo.',
};

export function errorFor(code: string | undefined): string {
  return (code && ERRORS[code]) || 'No pudimos obtener una respuesta. Intenta de nuevo.';
}

export type ChatAction =
  | { type: 'send'; id: string; text: string }
  | { type: 'reply'; id: string; reply: AssistantReply }
  | { type: 'fail'; id: string; code?: string }
  | { type: 'clear' };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        error: null,
        messages: [
          ...state.messages,
          { id: action.id, role: 'user', text: action.text },
          { id: `${action.id}-r`, role: 'assistant', text: 'Pensando…', pending: true },
        ],
      };
    case 'reply':
      return {
        conversationId: action.reply.conversation_id,
        error: null,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, notices: action.reply.notices }
            : m.id === `${action.id}-r`
              ? { id: m.id, role: 'assistant', text: action.reply.reply.text, tools: action.reply.tools_used }
              : m,
        ),
      };
    case 'fail': {
      // Si la conversación venció, se empieza de cero; si no, se quita solo el intento fallido.
      const restart = action.code === 'NOT_FOUND' || action.code === 'CONVERSATION_FULL';
      const messages = restart ? [] : state.messages.filter((m) => m.id !== `${action.id}-r`);
      return { conversationId: restart ? null : state.conversationId, messages, error: errorFor(action.code) };
    }
    case 'clear':
      return EMPTY_CHAT;
  }
}

export function isBusy(state: ChatState): boolean {
  return state.messages.some((m) => m.pending);
}
