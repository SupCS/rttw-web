import { getMinorUnit, type MoneyCurrencyCode } from './currencies.js';

export type Money = Readonly<{
  amountMinor: bigint;
  currency: MoneyCurrencyCode;
}>;

export function money(amountMinor: bigint, currency: MoneyCurrencyCode): Money {
  return Object.freeze({ amountMinor, currency });
}

export function zero(currency: MoneyCurrencyCode) {
  return money(0n, currency);
}

export function parseMajorAmount(value: string, currency: MoneyCurrencyCode): Money {
  const normalized = value.trim().replace(',', '.');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) throw new Error('Invalid monetary amount');

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const precision = getMinorUnit(currency);
  if (fraction.length > precision) throw new Error(`Too many decimal places for ${currency}`);

  const scale = 10n ** BigInt(precision);
  const paddedFraction = fraction.padEnd(precision, '0');
  const fractionMinor = paddedFraction ? BigInt(paddedFraction) : 0n;
  return money(sign * (BigInt(whole) * scale + fractionMinor), currency);
}

function assertSameCurrency(left: Money, right: Money) {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} and ${right.currency}`);
  }
}

export function add(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtract(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function negate(value: Money): Money {
  return money(-value.amountMinor, value.currency);
}

export function compare(left: Money, right: Money) {
  assertSameCurrency(left, right);
  return left.amountMinor < right.amountMinor ? -1 : left.amountMinor > right.amountMinor ? 1 : 0;
}

export function equals(left: Money, right: Money) {
  return left.currency === right.currency && left.amountMinor === right.amountMinor;
}

export function serializeMoney(value: Money) {
  return { amountMinor: value.amountMinor.toString(), currency: value.currency };
}

export function deserializeMoney(value: { amountMinor: string; currency: MoneyCurrencyCode }) {
  if (!/^-?\d+$/.test(value.amountMinor)) throw new Error('Invalid minor-unit amount');
  return money(BigInt(value.amountMinor), value.currency);
}

export function toMajorAmountInput(value: Money): string {
  const precision = getMinorUnit(value.currency);
  if (precision === 0) return value.amountMinor.toString();
  const sign = value.amountMinor < 0n ? '-' : '';
  const absolute = value.amountMinor < 0n ? -value.amountMinor : value.amountMinor;
  const digits = absolute.toString().padStart(precision + 1, '0');
  return `${sign}${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

export function convertMoney(value: Money, targetCurrency: MoneyCurrencyCode, rateDecimal: string): Money {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rateDecimal);
  if (!match) throw new Error('Invalid FX rate');
  const fractionalDigits = match[2]?.length ?? 0;
  const numerator = BigInt(`${match[1]}${match[2] ?? ''}`);
  if (numerator <= 0n) throw new Error('FX rate must be positive');

  const sourceScale = 10n ** BigInt(getMinorUnit(value.currency));
  const targetScale = 10n ** BigInt(getMinorUnit(targetCurrency));
  const denominator = sourceScale * (10n ** BigInt(fractionalDigits));
  const scaled = value.amountMinor * numerator * targetScale;
  const sign = scaled < 0n ? -1n : 1n;
  const absolute = scaled < 0n ? -scaled : scaled;
  const rounded = (absolute + denominator / 2n) / denominator;
  return money(sign * rounded, targetCurrency);
}

export type CurrencyDisplay = 'code' | 'symbol';

const currencySymbols: Record<MoneyCurrencyCode, string> = {
  CHF: '₣',
  EUR: '€',
  GBP: '£',
  GEL: '₾',
  JPY: '¥',
  KWD: 'د.ك',
  PLN: 'zł',
  RUB: '₽',
  TRY: '₺',
  UAH: '₴',
  USD: '$',
};

export function formatMoney(value: Money, locale: string, currencyDisplay: CurrencyDisplay = 'symbol') {
  const precision = getMinorUnit(value.currency);
  const scale = 10 ** precision;
  const numericAmount = Number(value.amountMinor) / scale;
  if (!Number.isSafeInteger(Number(value.amountMinor))) {
    throw new Error('Amount is too large for Intl formatting');
  }
  const formatter = new Intl.NumberFormat(locale, {
    currency: value.currency,
    currencyDisplay: currencyDisplay === 'code' ? 'code' : 'narrowSymbol',
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
    style: 'currency',
  });
  if (currencyDisplay === 'code') return formatter.format(numericAmount);
  return formatter.formatToParts(numericAmount).map((part) => part.type === 'currency' ? currencySymbols[value.currency] : part.value).join('');
}
