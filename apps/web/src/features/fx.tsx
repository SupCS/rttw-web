import { useState, type FormEvent } from 'react';
import { addDays, convertMoney, parseMajorAmount, serializeMoney, type MoneyCurrencyCode, type WireMoney } from '@rttw/domain';
import { history, rates, type FxRate } from '../data/api';
import { errorText } from '../data/use-ledger';
import { today } from '../format';
import { Amount, CurrencySelect, ErrorMessage, Field, text, type FeatureProps } from '../components/shared';

export function Fx(props: FeatureProps) {
  const { t, snapshot, locale, moneyDisplay } = props;
  const [base, setBase] = useState<MoneyCurrencyCode>('USD');
  const [quote, setQuote] = useState(snapshot.household.baseCurrency);
  const [result, setResult] = useState<{ value: WireMoney; rate: FxRate } | null>(null);
  const [series, setSeries] = useState<FxRate[]>([]);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [working, setWorking] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const date = text(data, 'date'); const manual = text(data, 'manual').replace(',', '.');
    setWorking(true); setError(''); setResult(null);
    try {
      const amount = parseMajorAmount(text(data, 'amount'), base);
      const rate = base === quote ? { base, quote, rateDecimal: '1', requestedDate: date, effectiveDate: date, provider: 'manual' } : manual ? { base, quote, rateDecimal: manual, requestedDate: date, effectiveDate: date, provider: 'manual' } : (await rates(base, quote, date)).rates.find((item) => item.base === base && item.quote === quote);
      if (!rate) { setError(t.noRate); return; }
      setResult({ value: serializeMoney(convertMoney(amount, quote, rate.rateDecimal)), rate });
    } catch (failure) { setError(errorText(failure, t)); } finally { setWorking(false); }
  }
  async function loadHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setHistoryLoading(true); setHistoryError(''); setSeries([]);
    try { const result = await history(base, quote, text(data, 'from'), text(data, 'to')); setSeries(result.rates); if (!result.rates.length) setHistoryError(t.noRate); } catch (failure) { setHistoryError(errorText(failure, t)); } finally { setHistoryLoading(false); }
  }
  return <><h1>{t.fx}</h1><section className="card"><h2>{t.calculator}</h2><form onSubmit={(event) => void calculate(event)}>
    <div className="form-grid"><Field label={`${t.from} · ${t.currency}`}><CurrencySelect value={base} onChange={(value) => { setBase(value); setResult(null); setSeries([]); }} /></Field><Field label={`${t.to} · ${t.currency}`}><CurrencySelect value={quote} onChange={(value) => { setQuote(value); setResult(null); setSeries([]); }} /></Field></div>
    <div className="form-grid"><Field label={t.amount}><input name="amount" inputMode="decimal" defaultValue="100" required /></Field><Field label={t.date}><input type="date" name="date" defaultValue={today()} required max={today()} /></Field></div>
    <Field label={`${t.manualRate} · ${base} → ${quote}`}><input name="manual" inputMode="decimal" /></Field><button className="primary" disabled={working}>{working ? t.loading : t.calculate}</button>
  </form><ErrorMessage message={error} />{result && <div className="fx-result"><Amount value={result.value} locale={locale} display={moneyDisplay} /><p>{t.rate}: 1 {base} = {result.rate.rateDecimal} {quote}</p><p className="muted">{t.provider}: {result.rate.provider} · {t.requestedDate}: {result.rate.requestedDate} · {t.effectiveDate}: {result.rate.effectiveDate}</p></div>}</section>
    <section className="card"><h2>{t.history} · {base} → {quote}</h2><form onSubmit={(event) => void loadHistory(event)}><div className="form-grid"><Field label={t.from}><input type="date" name="from" required defaultValue={addDays(today(), -30)} max={today()} /></Field><Field label={t.to}><input type="date" name="to" required defaultValue={today()} max={today()} /></Field></div><button disabled={historyLoading}>{historyLoading ? t.loading : t.loadHistory}</button></form><ErrorMessage message={historyError} />
    {!!series.length && <><RateChart series={series} label={`${t.history} · ${base} → ${quote}`} /><div className="table-wrap"><table><thead><tr><th>{t.requestedDate}</th><th>{t.effectiveDate}</th><th>{t.rate}</th><th>{t.provider}</th></tr></thead><tbody>{series.map((rate, index) => <tr key={`${rate.requestedDate}:${index}`}><td>{rate.requestedDate}</td><td>{rate.effectiveDate}</td><td>{rate.rateDecimal}</td><td>{rate.provider}</td></tr>)}</tbody></table></div></>}
    </section></>;
}
function RateChart({ series, label }: { series: FxRate[]; label: string }) {
  const values = series.map((item) => Number(item.rateDecimal)); const min = Math.min(...values); const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const points = values.map((value, index) => `${30 + index / Math.max(values.length - 1, 1) * 700},${180 - (max === min ? 0.5 : (value - min) / (max - min)) * 140}`).join(' ');
  return <svg className="rate-chart" viewBox="0 0 760 220" role="img" aria-label={label}><title>{label}</title><text x="30" y="20">{max}</text><text x="30" y="205">{min}</text><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" /><text x="30" y="220">{series[0]?.requestedDate}</text><text x="730" y="220" textAnchor="end">{series.at(-1)?.requestedDate}</text></svg>;
}
