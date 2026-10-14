import type { Pool } from 'pg';
import type { FxRate, MoneyCurrencyCode } from '@rttw/domain';
import { decimalFraction, divideDecimals, normalizeDecimal, parseProviderJson } from './decimal.js';

export type FxResult = { rates: FxRate[]; fetchedAt: string; stale: boolean };
export class FxUnavailable extends Error { readonly code = 'fx_unavailable'; readonly statusCode = 503; }
const DAY = 86_400_000;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith('0000') && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export class FxService {
  constructor(
    private readonly database?: Pick<Pool, 'query'>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly cache = new Map<string, FxResult>(),
  ) {}

  /** Cache queries join the caller's transaction instead of acquiring another pool client. */
  forDatabase(database: Pick<Pool, 'query'>): FxService {
    return new FxService(database, this.fetcher, this.cache);
  }

  async rates(base: MoneyCurrencyCode, quotes: MoneyCurrencyCode[], date = new Date().toISOString().slice(0, 10)): Promise<FxResult> {
    if (!validDate(date)) throw new FxUnavailable();
    const unique = [...new Set(quotes)].sort();
    const key = `rates:${base}:${unique.join(',')}:${date}`;
    return this.cached(key, async () => {
      return Promise.all(unique.map(async (quote): Promise<FxRate> => {
        if (quote === base) return { base, quote, rateDecimal: '1', requestedDate: date, effectiveDate: date, provider: 'frankfurter' };
        let rate: FxRate | undefined;
        try {
          const history = await this.frankfurter(base, quote, shiftDate(date, -10), date);
          rate = history.filter((item) => item.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
        } catch { /* Fall back to the official Georgian provider. */ }
        if (!rate) {
          // NBG's dated endpoint returns its effective publishing date.
          try { rate = await this.nbg(base, quote, date, date); } catch { /* No fabricated rate on upstream failure. */ }
        }
        if (!rate) throw new FxUnavailable();
        return { ...rate, requestedDate: date };
      }));
    });
  }

  async history(base: MoneyCurrencyCode, quote: MoneyCurrencyCode, from: string, to: string): Promise<FxResult> {
    if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * DAY) throw new FxUnavailable();
    return this.cached(`history:${base}:${quote}:${from}:${to}`, async () => {
      if (base === quote) return [{ base, quote, rateDecimal: '1', requestedDate: to, effectiveDate: to, provider: 'frankfurter' }];
      try {
        const rates = await this.frankfurter(base, quote, from, to);
        if (rates.length) return rates;
      } catch { /* NBG publishes reference rates for supported currencies. */ }
      const dates: string[] = [];
      for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date);
      const records: FxRate[] = [];
      for (let index = 0; index < dates.length; index += 5) {
        const results = await Promise.allSettled(dates.slice(index, index + 5).map((date) => this.nbg(base, quote, date, date)));
        for (const result of results) if (result.status === 'fulfilled') records.push(result.value);
      }
      if (!records.length) throw new FxUnavailable();
      return [...new Map(records.map((rate) => [rate.effectiveDate, rate])).values()].filter((rate) => rate.effectiveDate >= from && rate.effectiveDate <= to).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    });
  }

  private async request(url: URL): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new FxUnavailable();
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new FxUnavailable();
    return parseProviderJson(raw);
  }

  private async frankfurter(base: MoneyCurrencyCode, quote: MoneyCurrencyCode, from: string, to: string): Promise<FxRate[]> {
    const url = new URL('https://api.frankfurter.dev/v2/rates');
    url.search = new URLSearchParams({ base, quotes: quote, from, to }).toString();
    const payload = await this.request(url);
    if (!Array.isArray(payload)) throw new FxUnavailable();
    return payload.flatMap((value: unknown): FxRate[] => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      if (String(item.base).toUpperCase() !== base || String(item.quote).toUpperCase() !== quote || typeof item.date !== 'string' || !validDate(item.date) || item.date < from || item.date > to || typeof item.rate !== 'string') return [];
      return [{ base, quote, rateDecimal: normalizeDecimal(item.rate), requestedDate: to, effectiveDate: item.date, provider: 'frankfurter' }];
    });
  }

  private async nbg(base: MoneyCurrencyCode, quote: MoneyCurrencyCode, date: string, requestedDate: string): Promise<FxRate> {
    const url = new URL('https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/');
    url.searchParams.set('date', date);
    const payload = await this.request(url);
    if (!Array.isArray(payload) || !payload[0] || typeof payload[0] !== 'object') throw new FxUnavailable();
    const daily = payload[0] as Record<string, unknown>;
    const effectiveDate = typeof daily.date === 'string' ? daily.date.slice(0, 10) : '';
    if (!validDate(effectiveDate) || effectiveDate > requestedDate || !Array.isArray(daily.currencies)) throw new FxUnavailable();
    const fractions = new Map<string, { numerator: bigint; denominator: bigint }>([['GEL', { numerator: 1n, denominator: 1n }]]);
    for (const value of daily.currencies as unknown[]) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (typeof item.code !== 'string' || typeof item.rate !== 'string' || typeof item.quantity !== 'string' || !/^[1-9]\d*$/.test(item.quantity)) continue;
      const fraction = decimalFraction(item.rate);
      fractions.set(item.code, { numerator: fraction.numerator, denominator: fraction.denominator * BigInt(item.quantity) });
    }
    const left = fractions.get(base); const right = fractions.get(quote);
    if (!left || !right) throw new FxUnavailable();
    return { base, quote, requestedDate, effectiveDate, provider: 'nbg', rateDecimal: divideDecimals(left.numerator * right.denominator, left.denominator * right.numerator) };
  }

  private async cached(key: string, load: () => Promise<FxRate[]>): Promise<FxResult> {
    let cached = this.cache.get(key);
    if (!cached && this.database) {
      const stored = await this.database.query<{ payload: FxResult }>('SELECT payload FROM web_fx_cache WHERE cache_key=$1', [key]);
      cached = stored.rows[0]?.payload;
    }
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < DAY) return { ...cached, stale: false };
    try {
      const result = { rates: await load(), fetchedAt: new Date().toISOString(), stale: false };
      this.cache.set(key, result);
      if (this.database) await this.database.query('INSERT INTO web_fx_cache(cache_key,payload) VALUES($1,$2::jsonb) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,fetched_at=now()', [key, JSON.stringify(result)]);
      return result;
    } catch {
      if (cached) return { ...cached, stale: true };
      throw new FxUnavailable();
    }
  }
}
