import { Account, applyDelta, balanceDelta } from './account';
import { AccountNotActiveError, InsufficientFundsError } from './errors';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    ownerId: 'user-1',
    code: null,
    clabe: '999180000000000015',
    kind: 'CUSTOMER',
    normalSide: 'CREDIT',
    currency: 'MXN',
    status: 'ACTIVE',
    allowNegative: false,
    balance: 1_000,
    version: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('balanceDelta', () => {
  it('en una cuenta de cliente (acreedora) un crédito sube el saldo', () => {
    expect(balanceDelta('CREDIT', -500)).toBe(500);
    expect(balanceDelta('CREDIT', 500)).toBe(-500);
  });

  it('en una cuenta de liquidación (deudora) un débito sube el saldo', () => {
    expect(balanceDelta('DEBIT', 500)).toBe(500);
    expect(balanceDelta('DEBIT', -500)).toBe(-500);
  });
});

describe('applyDelta', () => {
  it('calcula el nuevo saldo', () => {
    expect(applyDelta(account(), -400, 'TRANSFER')).toBe(600);
    expect(applyDelta(account(), 400, 'DEPOSIT')).toBe(1_400);
  });

  it('permite dejar la cuenta exactamente en cero', () => {
    expect(applyDelta(account(), -1_000, 'TRANSFER')).toBe(0);
  });

  it('rechaza sobregiros en cuentas que no los permiten', () => {
    expect(() => applyDelta(account(), -1_001, 'TRANSFER')).toThrow(InsufficientFundsError);
  });

  it('las cuentas de sistema pueden quedar en negativo', () => {
    expect(applyDelta(account({ kind: 'SYSTEM', allowNegative: true, balance: 0 }), -5, 'DEPOSIT')).toBe(-5);
  });

  it('una cuenta congelada recibe dinero pero no lo envía', () => {
    const frozen = account({ status: 'FROZEN' });
    expect(applyDelta(frozen, 100, 'TRANSFER')).toBe(1_100);
    expect(() => applyDelta(frozen, -100, 'TRANSFER')).toThrow(AccountNotActiveError);
  });

  it('un reverso sí puede sacar dinero de una cuenta congelada', () => {
    expect(applyDelta(account({ status: 'FROZEN' }), -100, 'REVERSAL')).toBe(900);
  });

  it('una cuenta cerrada no acepta ningún movimiento', () => {
    const closed = account({ status: 'CLOSED' });
    expect(() => applyDelta(closed, 100, 'DEPOSIT')).toThrow(AccountNotActiveError);
    expect(() => applyDelta(closed, -100, 'REVERSAL')).toThrow(AccountNotActiveError);
  });

  it('detecta desbordamiento de saldo', () => {
    expect(() => applyDelta(account({ balance: Number.MAX_SAFE_INTEGER }), 1, 'DEPOSIT')).toThrow(/Desbordamiento/);
  });
});
