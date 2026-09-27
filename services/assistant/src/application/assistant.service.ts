import { createHash, randomUUID } from 'node:crypto';
import { localDate, localDateTime } from '../domain/format';
import { systemPrompt } from '../domain/prompt';
import { guardOutput, type GuardedOutput } from '../domain/output-guard';
import { mergeCounts, noticesFor, redact, type RedactionCounts } from '../domain/redaction';
import type { Conversation, ConversationStore, StoredMessage } from '../conversation/store';
import { ModelUnavailableError, textOf, toolUsesOf, type ContentBlock, type ModelClient, type Turn } from '../model/types';
import type { CoreApi } from '../tools/core-api';
import { TOOL_SPECS, ToolRunner } from '../tools/tools';

export interface AssistantLimits {
  dailyMessages: number;
  maxTurns: number;
  conversationTtlHours: number;
  maxToolRounds: number;
  historyTurns: number;
  maxReplyChars: number;
}

export const DEFAULT_LIMITS: AssistantLimits = {
  dailyMessages: 50,
  maxTurns: 20,
  conversationTtlHours: 24,
  maxToolRounds: 4,
  historyTurns: 10,
  maxReplyChars: 1200,
};

export class ConversationNotFoundError extends Error {}
export class DailyLimitError extends Error {}
export class ConversationFullError extends Error {}
export class AssistantUnavailableError extends Error {}

export interface AssistantReply {
  conversation_id: string;
  reply: { text: string; created_at: string };
  tools_used: string[];
  notices: string[];
}

export interface AuditRecord {
  event: 'assistant.turn';
  conversation_id: string;
  user: string;
  model: string;
  rounds: number;
  tools: string[];
  tool_errors: number;
  stop_reason: string;
  guardrail: boolean;
  redactions_input: RedactionCounts;
  redactions_tools: RedactionCounts;
  redactions_output: RedactionCounts;
  output_actions: GuardedOutput['actions'];
  suspicious_inputs: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export interface AssistantDeps {
  model: ModelClient;
  store: ConversationStore;
  core: (accessToken: string) => CoreApi;
  audit: (record: AuditRecord) => void;
  limits?: Partial<AssistantLimits>;
  now?: () => Date;
  auditSalt?: string;
}

const FALLBACK = 'No pude completar tu consulta en este momento. Intenta de nuevo en unos minutos.';

/**
 * Un turno de conversación:
 *   1. valida dueño, cuota diaria y largo de la conversación;
 *   2. redacta el mensaje del usuario;
 *   3. bucle modelo ↔ herramientas (solo lectura, con el token del usuario, máximo 4 rondas);
 *   4. redacta la respuesta del modelo (por si se le escapó algo);
 *   5. guarda solo texto redactado y deja un registro de auditoría sin contenido.
 */
export class AssistantService {
  private readonly limits: AssistantLimits;
  private readonly now: () => Date;

  constructor(private readonly deps: AssistantDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    this.now = deps.now ?? (() => new Date());
  }

  private userRef(sub: string): string {
    return createHash('sha256').update(`${this.deps.auditSalt ?? ''}:${sub}`).digest('hex').slice(0, 16);
  }

  async getConversation(ownerId: string, id: string): Promise<Conversation> {
    const c = await this.deps.store.get(id);
    if (!c || c.owner_id !== ownerId) throw new ConversationNotFoundError(); // 404 aunque exista: no se revela
    return c;
  }

  async deleteConversation(ownerId: string, id: string): Promise<void> {
    if (!(await this.deps.store.delete(id, ownerId))) throw new ConversationNotFoundError();
  }

  async handle(p: { ownerId: string; accessToken: string; conversationId?: string; message: string }): Promise<AssistantReply> {
    const started = Date.now();
    const now = this.now();
    let conversation: Conversation;
    let expectedVersion = 0;
    if (p.conversationId) {
      conversation = await this.getConversation(p.ownerId, p.conversationId);
      expectedVersion = conversation.version;
      if (conversation.messages.filter((m) => m.role === 'user').length >= this.limits.maxTurns) throw new ConversationFullError();
    } else {
      conversation = {
        id: randomUUID(),
        owner_id: p.ownerId,
        messages: [],
        created_at: now.toISOString(),
        expires_at: now.toISOString(),
        version: 0,
      };
    }

    const used = await this.deps.store.incrementDailyUsage(p.ownerId, localDate(now), 2 * 86_400);
    if (used > this.limits.dailyMessages) throw new DailyLimitError();

    const input = redact(p.message.trim());
    const notices = noticesFor(input.found);

    const history: Turn[] = conversation.messages
      .slice(-this.limits.historyTurns * 2)
      .map((m) => ({ role: m.role, content: [{ text: m.text }] }));
    const messages: Turn[] = [...history, { role: 'user', content: [{ text: input.text }] }];

    const runner = new ToolRunner(this.deps.core(p.accessToken), this.now);
    const tools: string[] = [];
    let toolErrors = 0;
    let toolRedactions: RedactionCounts = {};
    let usage = { inputTokens: 0, outputTokens: 0 };
    let stopReason = 'end_turn';
    let rounds = 0;
    let replyText = FALLBACK;
    const system = systemPrompt(localDateTime(now));

    try {
      for (;;) {
        rounds += 1;
        const res = await this.deps.model.converse({ system, messages, tools: TOOL_SPECS });
        usage = { inputTokens: usage.inputTokens + res.usage.inputTokens, outputTokens: usage.outputTokens + res.usage.outputTokens };
        stopReason = res.stopReason;
        messages.push(res.message);

        const uses = toolUsesOf(res.message);
        if (res.stopReason !== 'tool_use' || uses.length === 0) {
          replyText = textOf(res.message) || FALLBACK;
          break;
        }
        if (rounds > this.limits.maxToolRounds) {
          replyText = FALLBACK;
          stopReason = 'max_tool_rounds';
          break;
        }
        const results: ContentBlock[] = [];
        for (const use of uses.slice(0, 3)) {
          const outcome = await runner.run(use.name, use.input);
          tools.push(use.name);
          if (outcome.status === 'error') toolErrors += 1;
          toolRedactions = mergeCounts(toolRedactions, outcome.redactions);
          results.push({ toolResult: { toolUseId: use.toolUseId, content: [{ json: outcome.result }], status: outcome.status } });
        }
        // Converse exige un resultado por cada toolUse; las llamadas de más se rechazan.
        for (const extra of uses.slice(3)) {
          toolErrors += 1;
          results.push({ toolResult: { toolUseId: extra.toolUseId, content: [{ json: { error: 'Máximo 3 herramientas por turno.' } }], status: 'error' } });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (err) {
      if (err instanceof ModelUnavailableError) throw new AssistantUnavailableError(err.message);
      throw err;
    }

    // Red de seguridad sobre la salida: aunque el modelo haya sido manipulado, no pide
    // credenciales, no manda a sitios externos y no saca datos sensibles.
    const output = guardOutput(replyText);
    let text = output.text;
    if (text.length > this.limits.maxReplyChars) text = `${text.slice(0, this.limits.maxReplyChars - 1)}…`;

    const createdAt = this.now().toISOString();
    const added: StoredMessage[] = [
      { role: 'user', text: input.text, created_at: now.toISOString() },
      { role: 'assistant', text, created_at: createdAt },
    ];
    await this.deps.store.save(
      {
        ...conversation,
        messages: [...conversation.messages, ...added],
        expires_at: new Date(now.getTime() + this.limits.conversationTtlHours * 3_600_000).toISOString(),
        version: expectedVersion + 1,
      },
      expectedVersion,
    );

    this.deps.audit({
      event: 'assistant.turn',
      conversation_id: conversation.id,
      user: this.userRef(p.ownerId),
      model: this.deps.model.name,
      rounds,
      tools,
      tool_errors: toolErrors,
      stop_reason: stopReason,
      guardrail: stopReason === 'guardrail_intervened',
      redactions_input: input.found,
      redactions_tools: toolRedactions,
      redactions_output: output.redactions,
      output_actions: output.actions,
      suspicious_inputs: runner.suspicious,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      latency_ms: Date.now() - started,
    });

    return { conversation_id: conversation.id, reply: { text, created_at: createdAt }, tools_used: [...new Set(tools)], notices };
  }
}
