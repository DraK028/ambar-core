import type { AssistantReply } from '@ambar/api-client';
import { describe, expect, it } from 'vitest';
import { chatReducer, EMPTY_CHAT, errorFor, isBusy, toolsLine } from './chat';

const reply: AssistantReply = {
  conversation_id: '5f0d7c7e-3a52-4b8e-9d57-3f2b1a9c0e11',
  reply: { text: 'Tu saldo total es $1,250.00', created_at: '2026-09-27T10:00:00Z' },
  tools_used: ['consultar_cuentas'],
  notices: ['Ocultamos datos personales de tu mensaje antes de procesarlo.'],
};

describe('chat del asistente', () => {
  it('enviar muestra el mensaje y un "Pensando…" hasta la respuesta', () => {
    const s = chatReducer(EMPTY_CHAT, { type: 'send', id: 'a', text: '¿Saldo?' });
    expect(s.messages.map((m) => m.text)).toEqual(['¿Saldo?', 'Pensando…']);
    expect(isBusy(s)).toBe(true);

    const r = chatReducer(s, { type: 'reply', id: 'a', reply });
    expect(isBusy(r)).toBe(false);
    expect(r.conversationId).toBe(reply.conversation_id);
    expect(r.messages[0].notices).toEqual(reply.notices);
    expect(r.messages[1]).toMatchObject({ role: 'assistant', text: 'Tu saldo total es $1,250.00', tools: ['consultar_cuentas'] });
  });

  it('un error quita el "Pensando…" y conserva la conversación', () => {
    let s = chatReducer(EMPTY_CHAT, { type: 'send', id: 'a', text: 'hola' });
    s = chatReducer(s, { type: 'reply', id: 'a', reply });
    s = chatReducer(s, { type: 'send', id: 'b', text: 'otra' });
    s = chatReducer(s, { type: 'fail', id: 'b', code: 'ASSISTANT_UNAVAILABLE' });
    expect(s.messages.map((m) => m.text)).toEqual(['hola', 'Tu saldo total es $1,250.00', 'otra']);
    expect(s.conversationId).toBe(reply.conversation_id);
    expect(s.error).toMatch(/no está disponible/);
  });

  it('si la conversación venció se empieza de cero', () => {
    let s = chatReducer(EMPTY_CHAT, { type: 'send', id: 'a', text: 'hola' });
    s = chatReducer(s, { type: 'reply', id: 'a', reply });
    s = chatReducer(s, { type: 'fail', id: 'x', code: 'NOT_FOUND' });
    expect(s).toMatchObject({ conversationId: null, messages: [] });
    expect(chatReducer(s, { type: 'clear' })).toEqual(EMPTY_CHAT);
  });

  it('textos de apoyo', () => {
    expect(toolsLine(['consultar_cuentas', 'resumen_del_mes'])).toBe('Consulté tus cuentas, el resumen del mes.');
    expect(toolsLine([])).toBeNull();
    expect(errorFor('RATE_LIMITED')).toMatch(/límite diario/);
    expect(errorFor(undefined)).toMatch(/Intenta de nuevo/);
  });
});
