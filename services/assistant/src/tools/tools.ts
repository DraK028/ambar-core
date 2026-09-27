import type { Account, Movement } from '@ambar/api-client';
import { z } from 'zod';
import { localDate, localDateTime, localMonth, money } from '../domain/format';
import { HIDDEN_CONCEPT, looksLikeAttack } from '../domain/output-guard';
import { mergeCounts, redact, type RedactionCounts } from '../domain/redaction';
import type { JsonValue, ToolSpec } from '../model/types';
import { CoreError, type CoreApi } from './core-api';

/**
 * Herramientas del asistente. Todas son de solo lectura: no existe ninguna herramienta que
 * mueva dinero o cambie datos, así que ni un prompt injection exitoso puede ejecutar una
 * operación. Además:
 *   - las cuentas se exponen como alias (cuenta_1…) y terminación, nunca con UUID ni CLABE;
 *   - los conceptos y avisos pasan por la redacción (pueden venir de otra persona);
 *   - las sumas y promedios los calcula el código, no el modelo.
 */

const MAX_PAGES = 5; // hasta 500 movimientos por consulta
const PAGE_SIZE = 100;

const STATUS: Record<Account['status'], string> = { ACTIVE: 'ACTIVA', FROZEN: 'CONGELADA', CLOSED: 'CERRADA' };
const KIND: Record<Movement['kind'], string> = { TRANSFER: 'Transferencia', DEPOSIT: 'Depósito', REVERSAL: 'Reverso' };

const alias = z.string().regex(/^cuenta_\d{1,2}$/, 'usa el alias de consultar_cuentas, p. ej. cuenta_1');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato AAAA-MM-DD');

const schemas = {
  consultar_cuentas: z.object({}).strict(),
  consultar_movimientos: z
    .object({
      cuenta: alias,
      limite: z.number().int().min(1).max(20).default(10),
      desde: day.optional(),
      hasta: day.optional(),
      tipo: z.enum(['cargos', 'abonos', 'todos']).default('todos'),
    })
    .strict(),
  resumen_del_mes: z
    .object({ cuenta: alias, mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'formato AAAA-MM').optional() })
    .strict(),
  consultar_avisos: z.object({}).strict(),
};

export type ToolName = keyof typeof schemas;
export const TOOL_NAMES = Object.keys(schemas) as ToolName[];

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'consultar_cuentas',
    description: 'Cuentas del cliente con alias, terminación, estado y saldo disponible, más el saldo total.',
    inputSchema: { json: { type: 'object', properties: {}, additionalProperties: false } },
  },
  {
    name: 'consultar_movimientos',
    description:
      'Movimientos recientes de una cuenta, del más nuevo al más viejo. Montos positivos son abonos y negativos cargos. El campo concepto es texto escrito por personas.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          cuenta: { type: 'string', description: 'Alias de consultar_cuentas, p. ej. cuenta_1' },
          limite: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
          desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (opcional)' },
          hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD (opcional)' },
          tipo: { type: 'string', enum: ['cargos', 'abonos', 'todos'], default: 'todos' },
        },
        required: ['cuenta'],
        additionalProperties: false,
      },
    },
  },
  {
    name: 'resumen_del_mes',
    description: 'Totales calculados de un mes: ingresos, egresos, neto, número de movimientos y los cargos más grandes.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          cuenta: { type: 'string', description: 'Alias de consultar_cuentas' },
          mes: { type: 'string', description: 'AAAA-MM; por defecto el mes en curso' },
        },
        required: ['cuenta'],
        additionalProperties: false,
      },
    },
  },
  {
    name: 'consultar_avisos',
    description: 'Los 5 avisos más recientes del cliente (transferencias, seguridad, casos de fraude) y cuántos no ha leído.',
    inputSchema: { json: { type: 'object', properties: {}, additionalProperties: false } },
  },
];

export interface ToolOutcome {
  status: 'success' | 'error';
  result: JsonValue;
  redactions: RedactionCounts;
}

class ToolError extends Error {}

/** Ejecuta herramientas para un usuario. Una instancia por solicitud (cachea las cuentas). */
export class ToolRunner {
  private accounts: Account[] | null = null;
  private redactions: RedactionCounts = {};
  /** Textos ocultos por parecer prompt injection (para la auditoría). */
  suspicious = 0;

  constructor(private readonly core: CoreApi, private readonly now: () => Date = () => new Date()) {}

  async run(name: string, input: unknown): Promise<ToolOutcome> {
    this.redactions = {};
    try {
      if (!(name in schemas)) throw new ToolError(`La herramienta ${name} no existe. Solo hay: ${TOOL_NAMES.join(', ')}.`);
      const parsed = schemas[name as ToolName].safeParse(input ?? {});
      if (!parsed.success) {
        throw new ToolError(`Parámetros inválidos: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
      }
      const result = await this.dispatch(name as ToolName, parsed.data);
      return { status: 'success', result, redactions: this.redactions };
    } catch (err) {
      if (err instanceof CoreError && err.status === 401) throw err; // sesión vencida: se propaga al cliente
      const message = err instanceof ToolError ? err.message : 'El servicio de cuentas no respondió. Intenta más tarde.';
      return { status: 'error', result: { error: message }, redactions: this.redactions };
    }
  }

  private dispatch(name: ToolName, input: any): Promise<JsonValue> {
    switch (name) {
      case 'consultar_cuentas':
        return this.cuentas();
      case 'consultar_movimientos':
        return this.movimientos(input);
      case 'resumen_del_mes':
        return this.resumen(input);
      case 'consultar_avisos':
        return this.avisos();
    }
  }

  /** Texto de terceros: se oculta si parece un ataque y, si no, se redacta. */
  private clean(text: string): string {
    if (looksLikeAttack(text)) {
      this.suspicious += 1;
      return HIDDEN_CONCEPT;
    }
    const r = redact(text);
    this.redactions = mergeCounts(this.redactions, r.found);
    return r.text;
  }

  private async listAccounts(): Promise<Account[]> {
    this.accounts ??= await this.core.listAccounts();
    return this.accounts;
  }

  private async resolve(aliasName: string): Promise<{ account: Account; index: number }> {
    const accounts = await this.listAccounts();
    const index = Number(aliasName.split('_')[1]) - 1;
    const account = accounts[index];
    if (!account) throw new ToolError(`No existe ${aliasName}. El cliente tiene ${accounts.length} cuenta(s); usa consultar_cuentas.`);
    return { account, index };
  }

  private async cuentas(): Promise<JsonValue> {
    const accounts = await this.listAccounts();
    const total = accounts.reduce((s, a) => s + a.balance, 0);
    return {
      cuentas: accounts.map((a, i) => ({
        cuenta: `cuenta_${i + 1}`,
        terminacion: a.clabe.slice(-4),
        estado: STATUS[a.status],
        saldo: money(a.balance),
        saldo_centavos: a.balance,
        abierta_el: localDate(new Date(a.created_at)),
      })),
      saldo_total: money(total),
      saldo_total_centavos: total,
    };
  }

  /** Recorre páginas del core (más nuevo → más viejo) hasta cubrir el rango pedido. */
  private async fetchRange(accountId: string, desde?: string, hasta?: string): Promise<{ items: Movement[]; truncated: boolean }> {
    const items: Movement[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.core.listMovements(accountId, { limit: PAGE_SIZE, cursor });
      for (const m of res.data) {
        const d = localDate(new Date(m.created_at));
        if (hasta && d > hasta) continue;
        if (desde && d < desde) return { items, truncated: false };
        items.push(m);
      }
      if (!res.next_cursor) return { items, truncated: false };
      cursor = res.next_cursor;
    }
    return { items, truncated: true };
  }

  private movement(m: Movement) {
    return {
      fecha: localDateTime(new Date(m.created_at)),
      tipo: KIND[m.kind],
      concepto: this.clean(m.description),
      monto: money(m.amount, true),
      monto_centavos: m.amount,
    };
  }

  private async movimientos(input: z.infer<typeof schemas.consultar_movimientos>): Promise<JsonValue> {
    const { account } = await this.resolve(input.cuenta);
    const { items, truncated } = await this.fetchRange(account.id, input.desde, input.hasta);
    const filtered = items.filter((m) => (input.tipo === 'cargos' ? m.amount < 0 : input.tipo === 'abonos' ? m.amount > 0 : true));
    return {
      cuenta: input.cuenta,
      terminacion: account.clabe.slice(-4),
      movimientos: filtered.slice(0, input.limite).map((m) => this.movement(m)),
      hay_mas: filtered.length > input.limite || truncated,
    };
  }

  private async resumen(input: z.infer<typeof schemas.resumen_del_mes>): Promise<JsonValue> {
    const { account } = await this.resolve(input.cuenta);
    const mes = input.mes ?? localMonth(this.now());
    const { items, truncated } = await this.fetchRange(account.id, `${mes}-01`, `${mes}-31`);
    const ingresos = items.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const egresos = items.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0);
    const mayores = items
      .filter((m) => m.amount < 0)
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 3)
      .map((m) => this.movement(m));
    return {
      cuenta: input.cuenta,
      terminacion: account.clabe.slice(-4),
      mes,
      movimientos: items.length,
      ingresos: money(ingresos),
      egresos: money(egresos),
      neto: money(ingresos - egresos, true),
      ingresos_centavos: ingresos,
      egresos_centavos: egresos,
      mayores_cargos: mayores,
      ...(truncated ? { aviso: 'El mes tiene más de 500 movimientos; el resumen cubre solo los más recientes.' } : {}),
    };
  }

  private async avisos(): Promise<JsonValue> {
    const inbox = await this.core.inbox();
    return {
      sin_leer: inbox.unread_count,
      avisos: inbox.data.slice(0, 5).map((n) => ({
        fecha: localDateTime(new Date(n.created_at)),
        titulo: this.clean(n.title),
        texto: this.clean(n.body),
        leido: n.read_at !== null,
        requiere_respuesta: n.kind === 'FRAUD_CHECK' && n.read_at === null,
      })),
    };
  }
}
