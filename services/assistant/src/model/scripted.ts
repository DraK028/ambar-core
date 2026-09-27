import type { JsonValue, ModelClient, ModelRequest, ModelResponse, Turn } from './types';

/**
 * Modelo GUIONADO para desarrollo local, CI y demos sin AWS. No es IA: reconoce unas cuantas
 * intenciones por palabras clave, pide las mismas herramientas que pediría el modelo real y
 * redacta la respuesta con plantillas. Sirve para probar de punta a punta el bucle de
 * herramientas, la minimización de datos y las interfaces, con resultados deterministas.
 * La configuración impide usarlo en producción.
 */
type Intent = 'saldo' | 'resumen' | 'movimientos' | 'avisos' | 'operacion' | 'ayuda';

function intentOf(text: string): Intent {
  const t = text.toLowerCase();
  if (/\b(transfier|transferir|envía|envia|manda|paga|pagar|congela|deposita|retira)/.test(t)) return 'operacion';
  if (/(gast|resumen|mes|ingres|egres)/.test(t)) return 'resumen';
  if (/(movimiento|últim|ultim|historial|cargo|abono)/.test(t)) return 'movimientos';
  if (/(aviso|notificaci|alerta|fraude)/.test(t)) return 'avisos';
  if (/(saldo|cuánto tengo|cuanto tengo|dinero|cuenta)/.test(t)) return 'saldo';
  return 'ayuda';
}

const HELP =
  'Puedo decirte tu saldo, mostrarte tus últimos movimientos, resumir en qué gastaste este mes y revisar tus avisos. ' +
  'No puedo hacer operaciones por ti.';

let counter = 0;

function toolCall(name: string, input: Record<string, unknown>): ModelResponse {
  counter += 1;
  return {
    stopReason: 'tool_use',
    message: { role: 'assistant', content: [{ toolUse: { toolUseId: `guion-${counter}`, name, input } }] },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function say(text: string): ModelResponse {
  return { stopReason: 'end_turn', message: { role: 'assistant', content: [{ text }] }, usage: { inputTokens: 0, outputTokens: 0 } };
}

function lastUserText(messages: Turn[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = m.content.find((b): b is { text: string } => 'text' in b);
    if (text) return text.text;
  }
  return '';
}

function compose(intent: Intent, name: string, result: any): string {
  if (result?.error) return `No pude consultar tu información: ${result.error}`;
  switch (name) {
    case 'consultar_cuentas': {
      const lines = (result.cuentas as any[]).map((c) => `tu cuenta terminación ${c.terminacion} tiene ${c.saldo}${c.estado !== 'ACTIVA' ? ` (${c.estado.toLowerCase()})` : ''}`);
      if (lines.length === 0) return 'Todavía no tienes cuentas en Ámbar. Puedes abrir una desde Inicio.';
      return `Tu saldo total es ${result.saldo_total}: ${lines.join('; ')}.`;
    }
    case 'consultar_movimientos': {
      const items = result.movimientos as any[];
      if (items.length === 0) return 'No encontré movimientos en esa cuenta.';
      const list = items.map((m) => `${m.fecha.slice(0, 10)} ${m.tipo.toLowerCase()} «${m.concepto}» ${m.monto}`).join('; ');
      return `Tus últimos movimientos de la cuenta terminación ${result.terminacion}: ${list}.`;
    }
    case 'resumen_del_mes': {
      const top = (result.mayores_cargos as any[]).map((m) => `«${m.concepto}» ${m.monto}`).join(', ');
      return (
        `En ${result.mes} tuviste ${result.movimientos} movimientos: ingresaron ${result.ingresos} y salieron ${result.egresos} (neto ${result.neto}).` +
        (top ? ` Tus cargos más grandes: ${top}.` : '') +
        ' Un buen hábito es apartar una parte fija de cada ingreso apenas llega.'
      );
    }
    case 'consultar_avisos': {
      const pending = (result.avisos as any[]).filter((a) => a.requiere_respuesta);
      const base = `Tienes ${result.sin_leer} aviso(s) sin leer.`;
      return pending.length
        ? `${base} Hay ${pending.length} caso(s) de seguridad esperando tu respuesta: ábrelos en la pestaña Avisos.`
        : base;
    }
    default:
      return HELP;
  }
}

export class ScriptedModel implements ModelClient {
  readonly name = 'scripted';

  async converse(req: ModelRequest): Promise<ModelResponse> {
    const last = req.messages[req.messages.length - 1];
    const intent = intentOf(lastUserText(req.messages));

    // Llegó el resultado de una herramienta: se redacta la respuesta (o se pide la siguiente).
    const result = last?.content.find((b): b is Extract<typeof b, { toolResult: unknown }> => 'toolResult' in b);
    if (result) {
      const previous = req.messages[req.messages.length - 2];
      const use = previous?.content.find((b): b is Extract<typeof b, { toolUse: unknown }> => 'toolUse' in b);
      const json = result.toolResult.content[0].json as JsonValue;
      return say(compose(intent, use?.toolUse.name ?? '', json));
    }

    switch (intent) {
      case 'operacion':
        return say(
          'No puedo hacer operaciones por ti. Para transferir, entra a la pestaña Transferir de la app o de la banca web; ' +
            'si el monto es alto o la cuenta es nueva, te pediremos confirmar con tu biometría.',
        );
      case 'saldo':
        return toolCall('consultar_cuentas', {});
      case 'movimientos':
        return toolCall('consultar_movimientos', { cuenta: 'cuenta_1', limite: 5 });
      case 'resumen':
        return toolCall('resumen_del_mes', { cuenta: 'cuenta_1' });
      case 'avisos':
        return toolCall('consultar_avisos', {});
      default:
        return say(HELP);
    }
  }
}
