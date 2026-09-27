import { clabeIsValid, luhnIsValid, mergeCounts, noticesFor, redact } from './redaction';

describe('redacción de datos sensibles', () => {
  it('oculta tarjetas válidas (Luhn) con o sin separadores, conservando los últimos 4', () => {
    expect(redact('mi tarjeta es 4111 1111 1111 1111').text).toBe('mi tarjeta es [TARJETA ••1111]');
    expect(redact('4111-1111-1111-1111').text).toBe('[TARJETA ••1111]');
    expect(redact('5555555555554444 y ya').found).toEqual({ CARD: 1 });
  });

  it('oculta CLABE con dígito verificador válido', () => {
    expect(redact('mándalo a 999180000000000015').text).toBe('mándalo a [CLABE ••0015]');
    expect(clabeIsValid('999180000000000015')).toBe(true);
    expect(clabeIsValid('999180000000000016')).toBe(false);
  });

  it('cualquier número de 13 o más dígitos que no sea tarjeta ni CLABE también se oculta', () => {
    expect(redact('cuenta 1234567890123').text).toBe('cuenta [NÚMERO OCULTO]');
    expect(redact('999180000000000016').text).toBe('[NÚMERO OCULTO]');
  });

  it('oculta teléfonos de 10 dígitos y con lada 52', () => {
    expect(redact('llámame al 55 1234 5678').text).toBe('llámame al [TELÉFONO]');
    expect(redact('+52 5512345678').text).toBe('[TELÉFONO]');
  });

  it('no toca montos, fechas ni números cortos', () => {
    const text = 'Gasté $1,250.50 el 2026-09-27 en 3 compras, folio 123456';
    expect(redact(text)).toEqual({ text, found: {} });
  });

  it('oculta CURP, RFC, correos e identificadores internos', () => {
    const r = redact('CURP HEGG560427MVZRRL04, RFC GODE561231GR8, correo ana@example.com, id 5f0d7c7e-3a52-4b8e-9d57-3f2b1a9c0e11');
    expect(r.text).toBe('CURP [CURP], RFC [RFC], correo [CORREO], id [ID]');
    expect(r.found).toEqual({ CURP: 1, RFC: 1, EMAIL: 1, ID: 1 });
  });

  it('oculta el valor de NIP, CVV y contraseñas escritos en el texto', () => {
    expect(redact('mi NIP es 4821').text).toBe('mi NIP es [SECRETO]');
    expect(redact('cvv 123').text).toBe('cvv [SECRETO]');
    expect(redact('contraseña: Hola.2026').text).toBe('contraseña: [SECRETO]');
    expect(redact('el token expiró').found).toEqual({});
  });

  it('Luhn', () => {
    expect(luhnIsValid('4111111111111111')).toBe(true);
    expect(luhnIsValid('4111111111111112')).toBe(false);
    expect(luhnIsValid('123')).toBe(false);
  });

  it('avisos para el usuario según lo encontrado', () => {
    expect(noticesFor({})).toEqual([]);
    expect(noticesFor({ CARD: 1 })[0]).toMatch(/nunca te los pedirá/);
    expect(noticesFor({ EMAIL: 1 })).toEqual(['Ocultamos datos personales de tu mensaje antes de procesarlo.']);
    expect(noticesFor({ SECRET: 1, PHONE: 1 })).toHaveLength(2);
    expect(mergeCounts({ CARD: 1 }, { CARD: 2, ID: 1 })).toEqual({ CARD: 3, ID: 1 });
  });
});
