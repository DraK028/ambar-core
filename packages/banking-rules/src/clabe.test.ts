import { describe, expect, it } from 'vitest';
import { checkClabe, clabeCheckDigit, formatClabe, lastFour } from './clabe';

describe('CLABE (mismos vectores que el Ledger)', () => {
  it('calcula el verificador con pesos 3-7-1', () => {
    expect(clabeCheckDigit('03218000011835971')).toBe(9);
    expect(clabeCheckDigit('99918000000000001')).toBe(5);
  });

  it('acepta CLABEs válidas con espacios o guiones', () => {
    expect(checkClabe('032 180 00011835971 9')).toEqual({ ok: true, clabe: '032180000118359719' });
    expect(checkClabe('999-180-00000000001-5')).toEqual({ ok: true, clabe: '999180000000000015' });
  });

  it('explica cada error en términos del usuario', () => {
    expect(checkClabe('')).toMatchObject({ ok: false, reason: expect.stringMatching(/Escribe/) });
    expect(checkClabe('12a')).toMatchObject({ ok: false, reason: expect.stringMatching(/solo lleva números/) });
    expect(checkClabe('12345')).toMatchObject({ ok: false, reason: expect.stringMatching(/llevas 5/) });
    expect(checkClabe('032180000118359718')).toMatchObject({ ok: false, reason: expect.stringMatching(/último dígito/) });
  });

  it('formatea y abrevia', () => {
    expect(formatClabe('999180000000000015')).toBe('999 180 00000000001 5');
    expect(lastFour('999180000000000015')).toBe('0015');
  });
});
