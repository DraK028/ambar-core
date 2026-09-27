import type { ModelClient, ModelRequest, ModelResponse } from '../../src/model/types';

type Step = ModelResponse | ((req: ModelRequest) => ModelResponse);

/** Modelo de prueba: reproduce respuestas en orden y guarda lo que recibió. */
export class PlaybackModel implements ModelClient {
  readonly name = 'playback';
  readonly requests: ModelRequest[] = [];
  private i = 0;

  constructor(private readonly steps: Step[]) {}

  async converse(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps[Math.min(this.i++, this.steps.length - 1)];
    return typeof step === 'function' ? step(req) : step;
  }
}

let n = 0;
export const useTool = (name: string, input: Record<string, unknown> = {}): ModelResponse => ({
  stopReason: 'tool_use',
  message: { role: 'assistant', content: [{ toolUse: { toolUseId: `t${++n}`, name, input } }] },
  usage: { inputTokens: 100, outputTokens: 10 },
});

export const reply = (text: string, stopReason: ModelResponse['stopReason'] = 'end_turn'): ModelResponse => ({
  stopReason,
  message: { role: 'assistant', content: [{ text }] },
  usage: { inputTokens: 100, outputTokens: 20 },
});

/** Todo el texto que el modelo recibió (mensajes, resultados de herramientas y prompt). */
export function everythingSent(model: PlaybackModel): string {
  return JSON.stringify(model.requests);
}
