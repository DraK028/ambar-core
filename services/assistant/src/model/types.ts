/**
 * Mensajes con la misma forma que la API Converse de Bedrock, para que el modelo guionado
 * de desarrollo y el real sean intercambiables.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type ContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: [{ json: JsonValue }]; status: 'success' | 'error' } };

export interface Turn {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { json: Record<string, unknown> };
}

export type StopReason = 'end_turn' | 'tool_use' | 'guardrail_intervened' | 'max_tokens' | 'content_filtered' | 'stop_sequence';

export interface ModelResponse {
  stopReason: StopReason;
  message: Turn;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelRequest {
  system: string;
  messages: Turn[];
  tools: ToolSpec[];
}

export interface ModelClient {
  readonly name: string;
  converse(req: ModelRequest): Promise<ModelResponse>;
}

export class ModelUnavailableError extends Error {}

export function textOf(turn: Turn): string {
  return turn.content
    .filter((b): b is { text: string } => 'text' in b)
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function toolUsesOf(turn: Turn) {
  return turn.content.filter((b): b is Extract<ContentBlock, { toolUse: unknown }> => 'toolUse' in b).map((b) => b.toolUse);
}
