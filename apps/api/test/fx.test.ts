import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDecimal, parseProviderJson } from '../src/fx/decimal.js';
import { FxService, FxUnavailable } from '../src/fx/service.js';

test('provider decimals are never parsed through binary floating point', () => {
  assert.deepEqual(parseProviderJson('{"rate":0.123456789012345678,"quantity":100}'), { rate: '0.123456789012345678', quantity: '100' });
  assert.equal(normalizeDecimal('1.23456789012345678e-1'), '0.123456789012345678');
  assert.equal(normalizeDecimal('0.12345678901234567890123'), '0.12345678901234567890123');
});

test('historical selection uses the last publishing day and caches exact snapshots', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response('[{"base":"USD","quote":"EUR","date":"2026-10-09","rate":0.912345678901234567}]'); }) as typeof fetch;
  const service = new FxService(undefined, fetcher);
  const result = await service.rates('USD', ['EUR'], '2026-10-11');
  assert.equal(result.rates[0]?.effectiveDate, '2026-10-09');
  assert.equal(result.rates[0]?.rateDecimal, '0.912345678901234567');
  await service.rates('USD', ['EUR'], '2026-10-11');
  assert.equal(calls, 1);
});

test('NBG fallback accounts for quoted quantities using rational arithmetic', async () => {
  const fetcher = (async (url: URL | string | Request) => String(url).includes('frankfurter') ? new Response('', { status: 503 }) : new Response('[{"date":"2026-10-09T00:00:00","currencies":[{"code":"USD","quantity":1,"rate":2.7},{"code":"JPY","quantity":100,"rate":1.8}]}]')) as typeof fetch;
  const result = await new FxService(undefined, fetcher).rates('USD', ['JPY'], '2026-10-09');
  assert.equal(result.rates[0]?.provider, 'nbg');
  assert.equal(result.rates[0]?.rateDecimal, '150');
});

test('provider failure does not invent an exchange rate', async () => {
  const fetcher = (async () => new Response('', { status: 503 })) as typeof fetch;
  await assert.rejects(new FxService(undefined, fetcher).rates('USD', ['GEL'], '2026-10-09'), FxUnavailable);
});

test('FX inside a ledger transaction uses its existing connection instead of exhausting the pool', async () => {
  let calls = 0;
  const connection = { query: async () => { calls++; return { rows: [] }; } } as unknown as ConstructorParameters<typeof FxService>[0];
  const pool = { query: async () => { throw new Error('Must not acquire a second pool client'); } } as unknown as NonNullable<ConstructorParameters<typeof FxService>[0]>;
  const fetcher = (async () => new Response('[{"base":"USD","quote":"EUR","date":"2026-10-09","rate":0.9}]')) as typeof fetch;
  const fx = new FxService(pool, fetcher).forDatabase(connection!);
  assert.equal((await fx.rates('USD', ['EUR'], '2026-10-09')).rates[0]?.rateDecimal, '0.9');
  assert.equal(calls, 2);
});
