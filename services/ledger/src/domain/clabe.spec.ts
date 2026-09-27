import { buildAmbarClabe, clabeCheckDigit, formatClabe, isValidClabe } from './clabe';

describe('CLABE', () => {
  it('calcula el dígito verificador con pesos 3-7-1 (ejemplo publicado por bancos)', () => {
    // 032 180 00011835971 9 — CLABE de ejemplo usada en documentación bancaria.
    expect(clabeCheckDigit('03218000011835971')).toBe(9);
    expect(isValidClabe('032180000118359719')).toBe(true);
  });

  it('rechaza CLABEs con verificador incorrecto o longitud distinta de 18', () => {
    expect(isValidClabe('032180000118359718')).toBe(false);
    expect(isValidClabe('03218000011835971')).toBe(false);
    expect(isValidClabe('03218000011835971a')).toBe(false);
  });

  it('construye CLABEs de Ámbar válidas desde el consecutivo', () => {
    expect(buildAmbarClabe(1)).toBe('999180000000000015');
    for (const n of [1, 2, 17, 12345, 99_999_999_999]) {
      const clabe = buildAmbarClabe(n);
      expect(clabe).toHaveLength(18);
      expect(isValidClabe(clabe)).toBe(true);
    }
  });

  it('no acepta consecutivos fuera de rango', () => {
    expect(() => buildAmbarClabe(0)).toThrow();
    expect(() => buildAmbarClabe(100_000_000_000)).toThrow();
    expect(() => buildAmbarClabe(1.5)).toThrow();
  });

  it('exige 17 dígitos para calcular el verificador', () => {
    expect(() => clabeCheckDigit('123')).toThrow();
  });

  it('formatea la CLABE en bloques para pantalla', () => {
    expect(formatClabe('999180000000000015')).toBe('999 180 00000000001 5');
  });
});
