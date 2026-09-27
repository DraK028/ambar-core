import { FakeCore, movement } from '../../test/support/fake-core';
import { CoreError } from './core-api';
import { ToolRunner, TOOL_NAMES, TOOL_SPECS } from './tools';

const now = () => new Date('2026-09-27T16:00:00Z');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/i;
const LONG_DIGITS = /\d{13,}/;

describe('herramientas de solo lectura', () => {
  it('las especificaciones y los validadores cubren las mismas herramientas', () => {
    expect(TOOL_SPECS.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('consultar_cuentas: alias y terminación, nunca UUID ni CLABE completa', async () => {
    const out = await new ToolRunner(new FakeCore(), now).run('consultar_cuentas', {});
    expect(out.status).toBe('success');
    const json = JSON.stringify(out.result);
    expect(json).not.toMatch(UUID);
    expect(json).not.toContain('999180000000000015');
    expect(out.result).toMatchObject({
      cuentas: [
        { cuenta: 'cuenta_1', terminacion: '0015', estado: 'ACTIVA', saldo: '$12,345.67' },
        { cuenta: 'cuenta_2', terminacion: '0028', estado: 'CONGELADA' },
      ],
      saldo_total: '$12,845.67',
      saldo_total_centavos: 1_284_567,
    });
  });

  it('consultar_movimientos filtra por tipo y fechas, y redacta los conceptos', async () => {
    const core = new FakeCore();
    core.movements.push(movement(-1_000, 'mi tarjeta 4111 1111 1111 1111', '2026-09-26T15:00:00.000Z'));
    const runner = new ToolRunner(core, now);
    const cargos = await runner.run('consultar_movimientos', { cuenta: 'cuenta_1', tipo: 'cargos', desde: '2026-09-01' });
    const list = (cargos.result as any).movimientos;
    expect(list.map((m: any) => m.concepto)).toEqual(['mi tarjeta [TARJETA ••1111]', 'Súper', 'Renta']);
    expect(cargos.redactions).toEqual({ CARD: 1 });
    expect(JSON.stringify(cargos.result)).not.toMatch(UUID);
    expect(JSON.stringify(cargos.result)).not.toMatch(LONG_DIGITS);

    const limited = await runner.run('consultar_movimientos', { cuenta: 'cuenta_1', limite: 2 });
    expect((limited.result as any).movimientos).toHaveLength(2);
    expect((limited.result as any).hay_mas).toBe(true);
  });

  it('resumen_del_mes: las sumas las hace el código', async () => {
    const out = await new ToolRunner(new FakeCore(), now).run('resumen_del_mes', { cuenta: 'cuenta_1' });
    expect(out.result).toMatchObject({
      mes: '2026-09',
      movimientos: 3,
      ingresos: '$25,000.00',
      egresos: '$1,650.00',
      neto: '+$23,350.00',
      ingresos_centavos: 2_500_000,
      egresos_centavos: 165_000,
    });
    expect((out.result as any).mayores_cargos.map((m: any) => m.concepto)).toEqual(['Renta', 'Súper']);
  });

  it('recorre varias páginas del core para un mes completo', async () => {
    const core = new FakeCore();
    core.movements = Array.from({ length: 250 }, (_, i) => movement(-100, `m${i}`, '2026-09-10T15:00:00.000Z'));
    const out = await new ToolRunner(core, now).run('resumen_del_mes', { cuenta: 'cuenta_1', mes: '2026-09' });
    expect((out.result as any).movimientos).toBe(250);
    expect(core.calls.filter((c) => c.includes('/movements'))).toHaveLength(3);
  });

  it('parámetros inválidos, alias inexistente o herramienta desconocida son errores para el modelo, no excepciones', async () => {
    const runner = new ToolRunner(new FakeCore(), now);
    expect(await runner.run('consultar_movimientos', { cuenta: '5f0d7c7e-3a52-4b8e-9d57-3f2b1a9c0e11' })).toMatchObject({
      status: 'error',
      result: { error: expect.stringMatching(/alias/) },
    });
    expect((await runner.run('resumen_del_mes', { cuenta: 'cuenta_9' })).result).toEqual({
      error: 'No existe cuenta_9. El cliente tiene 2 cuenta(s); usa consultar_cuentas.',
    });
    expect((await runner.run('transferir', { a: 'x' })).result).toMatchObject({ error: expect.stringMatching(/no existe/) });
    expect((await runner.run('consultar_cuentas', { extra: 1 })).status).toBe('error');
  });

  it('una falla del core se reporta sin detalles; una sesión vencida se propaga', async () => {
    const core = new FakeCore();
    core.failWith = new CoreError(503, 'CORE_UNREACHABLE');
    const out = await new ToolRunner(core, now).run('consultar_cuentas', {});
    expect(out).toMatchObject({ status: 'error', result: { error: expect.stringMatching(/no respondió/) } });

    core.failWith = new CoreError(401, 'UNAUTHENTICATED');
    await expect(new ToolRunner(core, now).run('consultar_cuentas', {})).rejects.toBeInstanceOf(CoreError);
  });

  it('consultar_avisos marca los casos de fraude pendientes y redacta los textos', async () => {
    const core = new FakeCore();
    core.notifications = [
      { id: 'a', kind: 'FRAUD_CHECK', title: '¿Reconoces esta transferencia?', body: 'A la cuenta 999180000000000015', data: {}, created_at: '2026-09-27T10:00:00Z', read_at: null },
      { id: 'b', kind: 'WELCOME', title: 'Bienvenida', body: 'Lista', data: {}, created_at: '2026-09-01T10:00:00Z', read_at: '2026-09-01T11:00:00Z' },
    ];
    const out = await new ToolRunner(core, now).run('consultar_avisos', {});
    expect(out.result).toMatchObject({
      sin_leer: 1,
      avisos: [{ requiere_respuesta: true, texto: 'A la cuenta [CLABE ••0015]' }, { requiere_respuesta: false, leido: true }],
    });
  });
});
