export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  notices?: string[];
}

export interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  error: string | null;
}

export const EMPTY_CHAT: ChatState = { conversationId: null, messages: [], error: null };
