import { describe, expect, it } from 'vitest';

import {
  add,
  compare,
  convertMoney,
  deserializeMoney,
  equals,
  formatMoney,
  money,
  negate,
  parseMajorAmount,
  serializeMoney,
  subtract,
  toMajorAmountInput,
} from './money';

describe('money', () => {
  it('formats editable major units without floating-point conversion', () => {
    expect(toMajorAmountInput(money(12_305n, 'USD'))).toBe('123.05');
    expect(toMajorAmountInput(money(-5n, 'USD'))).toBe('-0.05');
  });

  it('parses major units without floating-point arithmetic', () => {
    expect(parseMajorAmount('10.10', 'GEL')).toEqual(money(1010n, 'GEL'));
    expect(parseMajorAmount('10,01', 'EUR')).toEqual(money(1001n, 'EUR'));
    expect(parseMajorAmount('-0.50', 'USD')).toEqual(money(-50n, 'USD'));
  });

  it('supports currencies with different minor-unit precision', () => {
    expect(parseMajorAmount('150', 'JPY')).toEqual(money(150n, 'JPY'));
    expect(parseMajorAmount('1.234', 'KWD')).toEqual(money(1234n, 'KWD'));
    expect(() => parseMajorAmount('1.1', 'JPY')).toThrow('Too many decimal places');
    expect(() => parseMajorAmount('1.234', 'GEL')).toThrow('Too many decimal places');
  });

  it('adds, subtracts, negates, and compares values exactly', () => {
    const left = money(1005n, 'GEL');
    const right = money(205n, 'GEL');
    expect(add(left, right)).toEqual(money(1210n, 'GEL'));
    expect(subtract(left, right)).toEqual(money(800n, 'GEL'));
    expect(negate(right)).toEqual(money(-205n, 'GEL'));
    expect(compare(left, right)).toBe(1);
    expect(equals(left, money(1005n, 'GEL'))).toBe(true);
  });

  it('rejects arithmetic across different currencies', () => {
    expect(() => add(money(100n, 'USD'), money(100n, 'EUR'))).toThrow('Currency mismatch');
    expect(() => subtract(money(100n, 'USD'), money(100n, 'EUR'))).toThrow('Currency mismatch');
  });

  it('serializes bigint amounts without precision loss', () => {
    const original = money(9_223_372_036_854_775_000n, 'GEL');
    const serialized = serializeMoney(original);
    expect(serialized.amountMinor).toBe('9223372036854775000');
    expect(deserializeMoney(serialized)).toEqual(original);
  });

  it('formats ordinary UI amounts according to locale', () => {
    expect(formatMoney(money(123456n, 'USD'), 'en-US')).toContain('1,234.56');
    const gel = formatMoney(money(123456n, 'GEL'), 'ka-GE');
    expect(gel).toContain('1234,56');
    expect(gel).toContain('₾');
  });

  it('switches between currency symbols and ISO codes', () => {
    expect(formatMoney(money(4200n, 'GEL'), 'en-US', 'symbol')).toContain('₾');
    expect(formatMoney(money(4200n, 'UAH'), 'en-US', 'symbol')).toContain('₴');
    expect(formatMoney(money(4200n, 'GEL'), 'en-US', 'code')).toContain('GEL');
  });

  it('rejects malformed values', () => {
    expect(() => parseMajorAmount('12.3.4', 'GEL')).toThrow('Invalid monetary amount');
    expect(() => deserializeMoney({ amountMinor: '10.5', currency: 'USD' })).toThrow('Invalid minor-unit amount');
  });
});

describe('convertMoney', () => {
  it('converts between currencies without floating-point arithmetic', () => {
    expect(convertMoney(money(10_00n, 'USD'), 'GEL', '2.7015').amountMinor).toBe(27_02n);
  });

  it('preserves the sign and respects currencies with different minor units', () => {
    expect(convertMoney(money(-1_000n, 'JPY'), 'KWD', '0.0020505').amountMinor).toBe(-2_051n);
  });

  it('rejects invalid and non-positive rates', () => {
    expect(() => convertMoney(money(100n, 'USD'), 'EUR', '0')).toThrow('positive');
    expect(() => convertMoney(money(100n, 'USD'), 'EUR', '1e-2')).toThrow('Invalid');
  });
});
