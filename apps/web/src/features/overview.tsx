import { useState } from 'react';
import type { MoneyCurrencyCode } from '@rttw/domain';
import { cashFlow, categoryRollup, scopedAccounts, isActual, reportPeriod } from '../data/derived';
import { useReportAmounts } from '../data/reporting';
import { displayAmount, displayDate, today } from '../format';
import { Amount, CurrencySelect, ErrorMessage, Field, type FeatureProps } from '../components/shared';
import { CategoryVisualization, CategoryViewSwitch, type CategoryView } from './category-visualization';
import { Icon, ui, Heading, MonthPicker } from '../components/design';
import { Forecast } from './forecast';

type Scope = 'personal' | 'household';
type ScopedProps = FeatureProps & { scope: Scope };
type Period = 'day' | 'week' | 'month' | 'year' | 'custom';
const dayMilliseconds = 86400000;
const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * dayMilliseconds).toISOString().slice(0, 10);
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function CalendarPeriodPicker({ period, anchor, onChange, t, locale }: Pick<FeatureProps, 't' | 'locale'> & {
  period: 'week' | 'year'; anchor: string; onChange: (date: string) => void;
}) {
  const week = reportPeriod('week', anchor);
  const year = Number(anchor.slice(0, 4));
  const adjacent = (direction: number) => period === 'week' ? shiftDate(week.from, direction * 7) : `${String(year + direction).padStart(4, '0')}-01-01`;
  const label = period === 'year' ? String(year) : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(new Date(`${week.from}T12:00:00`), new Date(`${week.to}T12:00:00`));
  return <div className="month-picker calendar-period-picker">
    <button type="button" className="icon-button" disabled={!validDate(adjacent(-1))} aria-label={period==='week'?t.previousWeek:t.previousYear} onClick={()=>onChange(adjacent(-1))}><Icon name="left" size={18}/></button>
    <span className="calendar-period-label" aria-live="polite">{label}</span>
    <button type="button" className="icon-button" disabled={!validDate(adjacent(1))} aria-label={period==='week'?t.nextWeek:t.nextYear} onClick={()=>onChange(adjacent(1))}><Icon name="right" size={18}/></button>
  </div>;
}

export function Overview({ scope, onScope, ...props }: FeatureProps & {
  scope: Scope; onScope: (scope: Scope) => void;
}) {
  const {snapshot,t,language}=props;
  return <><Heading title={ui(language,'analytics')} subtitle={props.isPersonal?t.personalLedger:snapshot.household.name}/><div className="analytics-top"><h2>{t.cashFlowTitle}</h2>{!props.isPersonal&&<select aria-label={t.scope} value={scope} onChange={e=>onScope(e.target.value as Scope)}><option value="personal">{t.personal}</option><option value="household">{t.household}</option></select>}</div><PeriodReports {...props} scope={props.isPersonal?'household':scope}/></>;
}

function PeriodReports({ scope, ...props }: ScopedProps) {
  const { snapshot, t, locale, language, moneyDisplay } = props;
  const [anchor, setAnchor] = useState(today());
  const [period, setPeriod] = useState<Period>('month');
  const [customRange, setCustomRange] = useState(() => ({ from: reportPeriod('month', today()).from, to: today() }));
  const [showPlanned, setShowPlanned] = useState(false);
  const [reporting, setReporting] = useState(true);
  const [reportCurrency, setReportCurrency] = useState(snapshot.household.baseCurrency);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<CategoryView>('donutView');
  const validRange = period !== 'custom' || validDate(customRange.from) && validDate(customRange.to) && customRange.from <= customRange.to;
  const range = period === 'custom' && validRange ? customRange : reportPeriod(period === 'custom' ? 'month' : period, anchor);
  const actualDate = today();
  const accountIds = new Set(scopedAccounts(snapshot, scope, true).map((item) => item.id));
  const reportTransactions = snapshot.transactions.filter((item) => validRange && accountIds.has(item.accountId) && isActual(item, actualDate) && item.transactionDate >= range.from && item.transactionDate <= range.to && item.transactionType !== 'transfer');
  const conversions = useReportAmounts(reportTransactions, reportCurrency, reporting, retry);
  const flow = cashFlow(snapshot, scope, range, actualDate, reporting, reporting ? conversions.amounts : undefined, reportCurrency);
  const rollup = categoryRollup(snapshot, scope, range, actualDate, reporting ? conversions.amounts : undefined);
  const periodLabel = period === 'month'
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${range.from}T12:00:00`))
    : period === 'year' ? anchor.slice(0, 4)
    : range.from === range.to ? displayDate(range.from, locale) : `${displayDate(range.from, locale)} — ${displayDate(range.to, locale)}`;
  const dayCount = Math.round((Date.parse(range.to) - Date.parse(range.from)) / dayMilliseconds) + 1;
  const daysPerBin = Math.max(1, Math.ceil(dayCount / 60));
  const bins = period === 'year'
    ? Array.from({ length: 12 }, (_, index) => reportPeriod('month', `${anchor.slice(0,4)}-${String(index+1).padStart(2,'0')}-01`))
    : Array.from({ length: Math.ceil(dayCount / daysPerBin) }, (_, index) => ({ from: shiftDate(range.from, index * daysPerBin), to: shiftDate(range.from, Math.min(dayCount - 1, (index + 1) * daysPerBin - 1)) }));
  const values=bins.map(bin=>reportTransactions.filter(tx=>tx.transactionDate>=bin.from&&tx.transactionDate<=bin.to&&tx.transactionType==='expense').reduce((sum,tx)=>{const v=conversions.amounts[tx.id];return sum+(v?-BigInt(v.amountMinor):0n)},0n));
  const max=values.reduce((m,v)=>v>m?v:m,1n);
  return <section className="overview-group overview-reports" aria-label={t.periodReports}>
    <div className="period-tabs segmented-control">{(['day','week','month','year','custom'] as const).map(value=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{value==='custom'?t.customPeriod:t[value]}</button>)}</div>
    {period==='month'&&<MonthPicker value={anchor.slice(0,7)} onChange={value=>setAnchor(`${value}-01`)} locale={locale}/>}
    {period==='day'&&<Field label={t.day}><input type="date" value={anchor} onChange={event=>validDate(event.target.value)&&setAnchor(event.target.value)}/></Field>}
    {(period==='week'||period==='year')&&<CalendarPeriodPicker period={period} anchor={anchor} onChange={setAnchor} t={t} locale={locale}/>}
    {period==='custom'&&<div className="report-date-range"><Field label={t.from}><input type="date" required value={customRange.from} max={customRange.to||undefined} aria-invalid={!validRange} onChange={event=>setCustomRange(current=>({...current,from:event.target.value}))}/></Field><Field label={t.to}><input type="date" required value={customRange.to} min={customRange.from||undefined} aria-invalid={!validRange} onChange={event=>setCustomRange(current=>({...current,to:event.target.value}))}/></Field></div>}
    {!validRange?<ErrorMessage message={t.invalidDateRange}/>:<>
    <details className="report-settings"><summary><Icon name="filter" size={17}/><span>{reporting?`${t.singleCurrency} · ${reportCurrency}`:t.separateCurrencies}</span><Icon name="down" size={14}/></summary>
      <div className="segmented-control report-currency-modes" role="group" aria-label={t.currencyMode}>
        <button type="button" aria-pressed={reporting} onClick={()=>setReporting(true)}>{t.singleCurrency}</button>
        <button type="button" aria-pressed={!reporting} onClick={()=>setReporting(false)}>{t.separateCurrencies}</button>
      </div>
      <p className="hint">{reporting?t.reportFxHint:t.separateCurrenciesHint}</p>
      {reporting&&<Field label={t.reportCurrency}><CurrencySelect value={reportCurrency} onChange={setReportCurrency}/></Field>}
      {reporting&&!!conversions.usedRates.length&&<details><summary>{t.fx}</summary>{conversions.usedRates.map(rate=><p className="hint" key={`${rate.base}:${rate.quote}:${rate.requestedDate}`}>1 {rate.base} = {rate.rateDecimal} {rate.quote} · {rate.provider} · {rate.requestedDate} → {rate.effectiveDate}</p>)}</details>}
    </details>
    {conversions.loading&&<p className="hint" role="status">{t.loading}</p>}{flow.pending>0&&!conversions.loading&&<div className="notice">{t.fx_pending}: {flow.pending}<button onClick={()=>setRetry(v=>v+1)}>{t.retry}</button></div>}
    {flow.totals.map(value=><div className="analytics-totals" key={value.currency}><div className="flow-card expense"><span><Icon name="arrow" size={16}/>{ui(language,'expense')}</span><strong><Amount value={{currency:value.currency,amountMinor:value.expense.toString()}} locale={locale} display={moneyDisplay}/></strong></div><div className="flow-card income"><span><Icon name="income" size={16}/>{ui(language,'income')}</span><strong><Amount value={{currency:value.currency,amountMinor:value.income.toString()}} locale={locale} display={moneyDisplay}/></strong></div><div className="net-row"><span>{t.net} · {value.currency}</span><strong className={value.income-value.expense>=0n?'positive':'negative'}><Amount value={{currency:value.currency,amountMinor:(value.income-value.expense).toString()}} locale={locale} display={moneyDisplay}/></strong></div></div>)}
    {!flow.totals.length&&!conversions.loading&&<div className="empty-state"><Icon name="chart" size={36}/><p>{ui(language,'noActual')}</p></div>}
    <section className="card spending-card"><div className="section-heading"><h2>{ui(language,'expense')}</h2><CategoryViewSwitch value={view} onChange={setView} t={t}/></div><CategoryVisualization rows={rollup} categories={snapshot.categories} language={language} locale={locale} display={moneyDisplay} t={t} view={view}/>{!rollup.length&&<p className="empty">{t.empty}</p>}</section>
    {reporting&&values.some(v=>v>0n)&&<section className="card daily-chart"><div className="section-heading"><h2>{t.expense} · {reportCurrency}</h2><span className="hint">{periodLabel}</span></div><div className="daily-bars" role="img" aria-label={`${t.expense} · ${periodLabel} · ${reportCurrency}`}>{values.map((v,i)=><span key={i} style={{height:`${Math.max(2,Number(v*100n/max))}%`}} className={bins[i]!.from<=today()&&bins[i]!.to>=today()?'today':''} title={`${displayDate(bins[i]!.from,locale)}${bins[i]!.to!==bins[i]!.from?` — ${displayDate(bins[i]!.to,locale)}`:''}: ${displayAmount(v,reportCurrency,locale)}`}/>)}</div><div className="chart-axis"><span>{displayDate(range.from,locale)}</span><span>{displayDate(range.to,locale)}</span></div></section>}
    <label className="forecast-switch"><span className="tile-icon lavender"><Icon name="calendar" size={20}/></span><span>{t.showPlanned}</span><input type="checkbox" checked={showPlanned} onChange={e=>setShowPlanned(e.target.checked)}/></label>
    {showPlanned&&<Forecast {...props} scope={scope} period={range} reportCurrency={reportCurrency} reporting={reporting}/>}
    </>}
  </section>;
}
