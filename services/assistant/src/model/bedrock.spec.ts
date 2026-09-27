import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { TOOL_SPECS } from '../tools/tools';
import { BedrockModel } from './bedrock';
import { ModelUnavailableError } from './types';

const req = { system: 'sistema', messages: [{ role: 'user' as const, content: [{ text: 'hola' }] }], tools: TOOL_SPECS };

describe('BedrockModel', () => {
  it('arma la llamada Converse con herramientas y guardrail', () => {
    const input = new BedrockModel({ modelId: 'modelo-x', guardrail: { id: 'gr-1', version: '3' } }).buildInput(req);
    expect(input).toMatchObject({
      modelId: 'modelo-x',
      system: [{ text: 'sistema' }],
      inferenceConfig: { maxTokens: 700, temperature: 0.2 },
      guardrailConfig: { guardrailIdentifier: 'gr-1', guardrailVersion: '3', trace: 'disabled' },
    });
    expect((input.toolConfig!.tools as any[]).map((t) => t.toolSpec.name)).toEqual(TOOL_SPECS.map((t) => t.name));
    expect(new BedrockModel({ modelId: 'm' }).buildInput(req)).not.toHaveProperty('guardrailConfig');
  });

  it('traduce la respuesta y el uso de tokens', async () => {
    const send = jest.fn(async (cmd: unknown) => {
      expect(cmd).toBeInstanceOf(ConverseCommand);
      return {
        stopReason: 'tool_use',
        output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'a', name: 'consultar_cuentas', input: {} } }] } },
        usage: { inputTokens: 321, outputTokens: 12 },
      };
    });
    const out = await new BedrockModel({ modelId: 'm' }, { send } as any).converse(req);
    expect(out.stopReason).toBe('tool_use');
    expect(out.usage).toEqual({ inputTokens: 321, outputTokens: 12 });
    expect(out.message.content[0]).toEqual({ toolUse: { toolUseId: 'a', name: 'consultar_cuentas', input: {} } });
  });

  it('errores de Bedrock (throttling, acceso) se vuelven ModelUnavailableError sin filtrar detalles', async () => {
    const err = Object.assign(new Error('User: arn:aws:iam::123:role/x is not authorized'), { name: 'AccessDeniedException' });
    const model = new BedrockModel({ modelId: 'm' }, { send: jest.fn().mockRejectedValue(err) } as any);
    await expect(model.converse(req)).rejects.toThrow(new ModelUnavailableError('Bedrock no respondió: AccessDeniedException'));
    const empty = new BedrockModel({ modelId: 'm' }, { send: jest.fn().mockResolvedValue({}) } as any);
    await expect(empty.converse(req)).rejects.toBeInstanceOf(ModelUnavailableError);
  });
});
