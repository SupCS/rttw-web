import { useEffect, useState } from 'react';
import type { MoneyCurrencyCode, WireMoney } from '@rttw/domain';
import { request, rates, type FxRate } from '../data/api';
import { convertBalance } from '../data/reporting';
import { errorText } from '../data/use-ledger';
import { Amount, ErrorMessage } from '../components/shared';
import type { Text } from '../i18n';

export function FxWidget({ base, quotes, date, t, locale }: { base: MoneyCurrencyCode; quotes: MoneyCurrencyCode[]; date: string; t: Text; locale: string }) {
  const [result, setResult] = useState<{ rates: FxRate[]; fetchedAt: string; stale?: boolean } | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0); const [loading, setLoading] = useState(true);
  const pair = quotes.filter((item) => item !== base).sort().join(',');
  useEffect(() => {
    let alive = true; setLoading(true); setError(''); setResult(null);
    if (!pair) { setLoading(false); return; }
    void request<{ rates: FxRate[]; fetchedAt: string; stale?: boolean }>(`/api/fx/rates?base=${base}&quotes=${pair}&date=${date}`).then((result) => { if (alive) setResult(result); }).catch((failure: unknown) => { if (alive) setError(errorText(failure, t)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [base, pair, date, attempt]);
  return <section className="card"><div className="section-heading"><h2>{t.fx} · {base}</h2><a href="#fx">{t.calculator} →</a></div>
    {loading ? <p role="status">{t.loading}</p> : error ? <><ErrorMessage message={error} /><button onClick={() => setAttempt((value) => value + 1)}>{t.retry}</button></> : <>
      <div className="card-grid">{pair.split(',').filter(Boolean).map((quote) => { const rate = result?.rates.find((item) => item.quote === quote); return <div className="rate-tile" key={quote}><strong>1 {base} = {rate?.rateDecimal ?? '—'} {quote}</strong><p className="hint">{rate ? `${rate.provider} · ${t.effectiveDate}: ${rate.effectiveDate}` : t.noRate}</p></div>; })}</div>
      {result && <p className="hint">{t.requestedDate}: {date} · {t.fetchedAt}: {new Date(result.fetchedAt).toLocaleString(locale)}{result.stale ? ` · ${t.staleRate}` : ''}</p>}
    </>}
  </section>;
}
export function ConvertedBalance({ values, currency, date, locale, display, t }: { values: WireMoney[]; currency: MoneyCurrencyCode; date: string; locale: string; display: 'code' | 'symbol'; t: Text }) {
  const [available, setAvailable] = useState<FxRate[]>([]); const [loading, setLoading] = useState(true);
  const key = values.map((value) => value.currency).filter((value) => value !== currency).sort().join(',');
  useEffect(() => {
    let alive = true; setLoading(true); setAvailable([]);
    void Promise.allSettled(key.split(',').filter(Boolean).map((base) => rates(base as MoneyCurrencyCode, currency, date))).then((results) => {
      if (!alive) return; setAvailable(results.flatMap((result) => result.status === 'fulfilled' ? result.value.rates : [])); setLoading(false);
    }); return () => { alive = false; };
  }, [key, currency, date]);
  const converted = convertBalance(values, currency, available);
  if (!key) return null;
  return <small className="hint">{t.convertedBalance} · {currency}: {loading ? t.loading : converted ? <Amount value={converted} locale={locale} display={display} /> : t.fx_pending}<br />{t.asOf}: {date}{available.length ? ` · ${[...new Set(available.map((item) => `${item.provider} ${item.effectiveDate}`))].join(', ')}` : ''}</small>;
}
