import { getMinorUnit, type MoneyCurrencyCode } from '@rttw/domain';

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function displayAmount(amount: bigint, currency: MoneyCurrencyCode, locale: string): string {
  const precision = getMinorUnit(currency);
  const scale = 10n ** BigInt(precision);
  const absolute = amount < 0n ? -amount : amount;
  const integer = new Intl.NumberFormat(locale).format(absolute / scale);
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const fraction = precision ? `${separator}${(absolute % scale).toString().padStart(precision, '0')}` : '';
  return `${amount < 0n ? '−' : ''}${integer}${fraction} ${currency}`;
}

export function displayDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
}
