import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { ModelUnavailableError, type ModelClient, type ModelRequest, type ModelResponse, type StopReason, type Turn } from './types';

export interface BedrockOptions {
  modelId: string;
  guardrail?: { id: string; version: string };
  maxTokens?: number;
  temperature?: number;
}

/**
 * Amazon Bedrock con la API Converse y tool use.
 * - Los datos no salen de la cuenta de AWS ni se usan para entrenar modelos.
 * - Con guardrail: filtros de contenido, detección de prompt attacks, temas denegados y
 *   anonimización de PII en la entrada y en la salida (además de la redacción propia).
 */
export class BedrockModel implements ModelClient {
  readonly name = 'bedrock';

  constructor(
    private readonly opts: BedrockOptions,
    private readonly client: Pick<BedrockRuntimeClient, 'send'> = new BedrockRuntimeClient({}),
  ) {}

  buildInput(req: ModelRequest): ConverseCommandInput {
    return {
      modelId: this.opts.modelId,
      system: [{ text: req.system }],
      messages: req.messages as ConverseCommandInput['messages'],
      toolConfig: { tools: req.tools.map((toolSpec) => ({ toolSpec })) as never },
      inferenceConfig: { maxTokens: this.opts.maxTokens ?? 700, temperature: this.opts.temperature ?? 0.2 },
      ...(this.opts.guardrail
        ? { guardrailConfig: { guardrailIdentifier: this.opts.guardrail.id, guardrailVersion: this.opts.guardrail.version, trace: 'disabled' } }
        : {}),
    };
  }

  async converse(req: ModelRequest): Promise<ModelResponse> {
    let out: ConverseCommandOutput;
    try {
      out = await this.client.send(new ConverseCommand(this.buildInput(req)));
    } catch (err) {
      throw new ModelUnavailableError(`Bedrock no respondió: ${(err as Error).name}`);
    }
    const message = out.output?.message;
    if (!message) throw new ModelUnavailableError('Bedrock respondió sin mensaje.');
    return {
      stopReason: (out.stopReason ?? 'end_turn') as StopReason,
      message: { role: 'assistant', content: (message.content ?? []) as Turn['content'] },
      usage: { inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0 },
    };
  }
}
