import { UnbalancedEntryError, ValidationError } from './errors';
import { assertBalanced, depositPostings, reversalPostings, transferPostings } from './journal-entry';

describe('asiento de doble partida', () => {
  it('acepta postings que suman cero', () => {
    expect(() => assertBalanced([{ accountId: 'a', amount: 100 }, { accountId: 'b', amount: -100 }])).not.toThrow();
    expect(() =>
      assertBalanced([
        { accountId: 'a', amount: 150 },
        { accountId: 'b', amount: -100 },
        { accountId: 'c', amount: -50 },
      ]),
    ).not.toThrow();
  });

  it('rechaza asientos descuadrados', () => {
    expect(() => assertBalanced([{ accountId: 'a', amount: 100 }, { accountId: 'b', amount: -99 }])).toThrow(
      UnbalancedEntryError,
    );
  });

  it('exige al menos dos postings', () => {
    expect(() => assertBalanced([{ accountId: 'a', amount: 0 }])).toThrow(UnbalancedEntryError);
    expect(() => assertBalanced([])).toThrow(UnbalancedEntryError);
  });

  it('rechaza montos en cero, con decimales o fuera del rango seguro', () => {
    expect(() => assertBalanced([{ accountId: 'a', amount: 0 }, { accountId: 'b', amount: 0 }])).toThrow(ValidationError);
    expect(() => assertBalanced([{ accountId: 'a', amount: 10.5 }, { accountId: 'b', amount: -10.5 }])).toThrow(
      ValidationError,
    );
    expect(() =>
      assertBalanced([
        { accountId: 'a', amount: Number.MAX_SAFE_INTEGER + 1 },
        { accountId: 'b', amount: -(Number.MAX_SAFE_INTEGER + 1) },
      ]),
    ).toThrow(ValidationError);
  });

  it('una transferencia debita el origen y acredita el destino', () => {
    const postings = transferPostings('origen', 'destino', 45_000);
    expect(postings).toEqual([
      { accountId: 'origen', amount: 45_000 },
      { accountId: 'destino', amount: -45_000 },
    ]);
    expect(() => assertBalanced(postings)).not.toThrow();
  });

  it('un depósito debita la cuenta de liquidación y acredita al cliente', () => {
    const postings = depositPostings('spei', 'cliente', 1_000);
    expect(postings).toEqual([
      { accountId: 'spei', amount: 1_000 },
      { accountId: 'cliente', amount: -1_000 },
    ]);
  });

  it('el reverso invierte cada posting y sigue cuadrando', () => {
    const original = transferPostings('a', 'b', 700);
    const reversal = reversalPostings(original);
    expect(reversal).toEqual([
      { accountId: 'a', amount: -700 },
      { accountId: 'b', amount: 700 },
    ]);
    expect(() => assertBalanced(reversal)).not.toThrow();
  });
});
