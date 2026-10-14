/** Preserve JSON decimal literals before JSON.parse can turn them into binary floats. */
export function parseProviderJson(raw: string): unknown {
  return JSON.parse(raw.replace(/("(?:rate|quantity)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"')) as unknown;
}

export function decimalFraction(raw: string): { numerator: bigint; denominator: bigint } {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match || raw.length > 100) throw new Error('Invalid rate');
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (Math.abs(exponent) > 100) throw new Error('Invalid rate');
  const numerator = BigInt(`${match[1]}${match[2] ?? ''}`);
  if (numerator <= 0n) throw new Error('Invalid rate');
  return exponent >= 0 ? { numerator: numerator * 10n ** BigInt(exponent), denominator: 1n } : { numerator, denominator: 10n ** BigInt(-exponent) };
}

export function divideDecimals(numerator: bigint, denominator: bigint, precision = 18): string {
  if (numerator <= 0n || denominator <= 0n) throw new Error('Invalid rate');
  const scale = 10n ** BigInt(precision);
  const rounded = (numerator * scale + denominator / 2n) / denominator;
  if (!rounded) throw new Error('Rate below supported precision');
  const digits = rounded.toString().padStart(precision + 1, '0');
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`.replace(/0+$/, '').replace(/\.$/, '');
}

export function normalizeDecimal(raw: string): string {
  const fraction = decimalFraction(raw);
  if (fraction.denominator === 1n) return fraction.numerator.toString();
  const precision = fraction.denominator.toString().length - 1;
  const digits = fraction.numerator.toString().padStart(precision + 1, '0');
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`.replace(/0+$/, '').replace(/\.$/, '');
}
