import { useState } from 'react';
import type { MoneyCurrencyCode } from '@rttw/domain';
import { balances, cashFlow, categoryRollup, scopedAccounts, accountBalances, isActual, reportPeriod } from '../data/derived';
import { useReportAmounts } from '../data/reporting';
import { displayDate, today } from '../format';
import { Amount, CurrencySelect, Field, type FeatureProps } from '../components/shared';
import { ConvertedBalance, FxWidget } from './overview-fx';
import { CategoryVisualization, CategoryViewSwitch, type CategoryView } from './category-visualization';
import { Icon, ui, Heading, MonthPicker } from '../components/design';
import { Forecast } from './forecast';

type Scope = 'personal' | 'household';
type ScopedProps = FeatureProps & { scope: Scope };

export function Overview({ scope, onScope, enabledCurrencies, ...props }: FeatureProps & {
  scope: Scope; onScope: (scope: Scope) => void; enabledCurrencies: MoneyCurrencyCode[];
}) {
  const {snapshot,t,language}=props;
  const [panel,setPanel]=useState<'reports'|'balances'>('reports');
  return <><Heading title={ui(language,'analytics')} subtitle={snapshot.household.name}/><div className="analytics-top"><div className="text-tabs"><button aria-pressed={panel==='reports'} onClick={()=>setPanel('reports')}>{t.cashFlowTitle}</button><button aria-pressed={panel==='balances'} onClick={()=>setPanel('balances')}>{t.balances}</button></div><select aria-label={t.scope} value={scope} onChange={e=>onScope(e.target.value as Scope)}><option value="personal">{t.personal}</option><option value="household">{t.household}</option></select></div>{panel==='reports'?<PeriodReports {...props} scope={scope}/>:<BalanceSnapshot {...props} scope={scope} enabledCurrencies={enabledCurrencies}/>}</>;
}

function PeriodReports({ scope, ...props }: ScopedProps) {
  const { snapshot, t, locale, language, moneyDisplay } = props;
  const [anchor, setAnchor] = useState(today());
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [showPlanned, setShowPlanned] = useState(false);
  const [reporting, setReporting] = useState(true);
  const [reportCurrency, setReportCurrency] = useState(snapshot.household.baseCurrency);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<CategoryView>('donutView');
  const range = reportPeriod(period, anchor);
  const actualDate = today();
  const accountIds = new Set(scopedAccounts(snapshot, scope).map((item) => item.id));
  const reportTransactions = snapshot.transactions.filter((item) => accountIds.has(item.accountId) && isActual(item, actualDate) && item.transactionDate >= range.from && item.transactionDate <= range.to && item.transactionType !== 'transfer');
  const conversions = useReportAmounts(reportTransactions, reportCurrency, reporting, retry);
  const flow = cashFlow(snapshot, scope, range, actualDate, reporting, reporting ? conversions.amounts : undefined, reportCurrency);
  const rollup = categoryRollup(snapshot, scope, range, actualDate, reporting ? conversions.amounts : undefined);
  const periodLabel = period === 'month'
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${range.from}T12:00:00`))
    : period === 'year' ? anchor.slice(0, 4)
    : range.from === range.to ? displayDate(range.from, locale) : `${displayDate(range.from, locale)} — ${displayDate(range.to, locale)}`;
  const days=Array.from({length:Math.min(366,Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1)},(_,i)=>new Date(Date.parse(range.from)+i*86400000).toISOString().slice(0,10));
  const bins=period==='year'?Array.from({length:12},(_,i)=>`${anchor.slice(0,4)}-${String(i+1).padStart(2,'0')}`):days;
  const values=bins.map(date=>reportTransactions.filter(tx=>tx.transactionDate.startsWith(date)&&tx.transactionType==='expense').reduce((sum,tx)=>{const v=conversions.amounts[tx.id];return sum+(v?-BigInt(v.amountMinor):0n)},0n));
  const max=values.reduce((m,v)=>v>m?v:m,1n);
  return <section className="overview-group overview-reports" aria-label={t.periodReports}>
    <div className="period-tabs segmented-control">{(['day','week','month','year'] as const).map(value=><button key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{t[value]}</button>)}</div>
    {period==='month'?<MonthPicker value={anchor.slice(0,7)} onChange={value=>setAnchor(`${value}-01`)} locale={locale}/>:<Field label={t.dateInPeriod}><input type="date" value={anchor} onChange={e=>e.target.value&&setAnchor(e.target.value)}/></Field>}
    <details className="report-settings"><summary><Icon name="filter" size={17}/><span>{reporting?reportCurrency:t.originalCurrencies}</span><Icon name="down" size={14}/></summary><label className="check"><input type="checkbox" checked={reporting} onChange={e=>setReporting(e.target.checked)}/>{t.reportCurrency}</label>{reporting&&<Field label={t.currency}><CurrencySelect value={reportCurrency} onChange={setReportCurrency}/></Field>}<p className="hint">{t.reportFxHint}</p>{!!conversions.usedRates.length&&<details><summary>{t.fx}</summary>{conversions.usedRates.map(rate=><p className="hint" key={`${rate.base}:${rate.quote}:${rate.requestedDate}`}>1 {rate.base} = {rate.rateDecimal} {rate.quote} · {rate.provider} · {rate.requestedDate} → {rate.effectiveDate}</p>)}</details>}</details>
    {conversions.loading&&<p className="hint" role="status">{t.loading}</p>}{flow.pending>0&&!conversions.loading&&<div className="notice">{t.fx_pending}: {flow.pending}<button onClick={()=>setRetry(v=>v+1)}>{t.retry}</button></div>}
    {flow.totals.map(value=><div className="analytics-totals" key={value.currency}><div className="flow-card expense"><span><Icon name="arrow" size={16}/>{ui(language,'expense')}</span><strong><Amount value={{currency:value.currency,amountMinor:value.expense.toString()}} locale={locale} display={moneyDisplay}/></strong></div><div className="flow-card income"><span><Icon name="income" size={16}/>{ui(language,'income')}</span><strong><Amount value={{currency:value.currency,amountMinor:value.income.toString()}} locale={locale} display={moneyDisplay}/></strong></div><div className="net-row"><span>{t.net} · {value.currency}</span><strong className={value.income-value.expense>=0n?'positive':'negative'}><Amount value={{currency:value.currency,amountMinor:(value.income-value.expense).toString()}} locale={locale} display={moneyDisplay}/></strong></div></div>)}
    {!flow.totals.length&&!conversions.loading&&<div className="empty-state"><Icon name="chart" size={36}/><p>{ui(language,'noActual')}</p></div>}
    <section className="card spending-card"><div className="section-heading"><h2>{ui(language,'expense')}</h2><CategoryViewSwitch value={view} onChange={setView} t={t}/></div><CategoryVisualization rows={rollup} categories={snapshot.categories} language={language} locale={locale} display={moneyDisplay} t={t} view={view}/>{!rollup.length&&<p className="empty">{t.empty}</p>}</section>
    {reporting&&values.some(v=>v>0n)&&<section className="card daily-chart"><div className="section-heading"><h2>{t.expense} · {reportCurrency}</h2><span className="hint">{periodLabel}</span></div><div className="daily-bars" role="img" aria-label={`${t.expense} · ${periodLabel} · ${reportCurrency}`}>{values.map((v,i)=><span key={i} style={{height:`${Math.max(2,Number(v*100n/max))}%`}} className={bins[i]===today()?'today':''} title={`${bins[i]}: ${v.toString()} minor units`}/>)}</div><div className="chart-axis"><span>{bins[0]}</span><span>{bins.at(-1)}</span></div></section>}
    <label className="forecast-switch"><span className="tile-icon lavender"><Icon name="calendar" size={20}/></span><span>{t.showPlanned}</span><input type="checkbox" checked={showPlanned} onChange={e=>setShowPlanned(e.target.checked)}/></label>
    {showPlanned&&<Forecast {...props} scope={scope} period={range} reportCurrency={reportCurrency} reporting={reporting}/>}
  </section>;
}

function BalanceSnapshot({ scope, enabledCurrencies, ...props }: ScopedProps & { enabledCurrencies: MoneyCurrencyCode[] }) {
  const { snapshot, t, locale, moneyDisplay } = props;
  const [date, setDate] = useState(today());
  const accounts = scopedAccounts(snapshot, scope);
  const accountIds = new Set(accounts.map((item) => item.id));
  const quotes = [...new Set([...enabledCurrencies, ...accounts.flatMap((item) => item.openingBalances.map((value) => value.currency))])];
  return <section className="overview-group overview-snapshot" aria-labelledby="overview-snapshot-title">
    <header className="overview-group-header"><div className="section-heading"><div><h2 id="overview-snapshot-title">{t.balanceSnapshot}</h2><p className="hint">{t.snapshotDateHint}</p></div><Field label={t.asOf}><input type="date" required value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} max={today()} /></Field></div></header>
    <div className="overview-widget-grid">
      <section className="card"><h3>{t.balances}</h3><p className="widget-context">{t.asOf}: {displayDate(date, locale)}</p><p className="hint">{t.balanceHint}</p><div className="balance-grid">{balances(snapshot, scope, date).map((value) => <div className="balance-tile" key={value.currency}><small>{value.currency}</small><Amount value={value} locale={locale} display={moneyDisplay} /></div>)}</div>{!accounts.length && <p className="empty">{t.empty} <a href="#accounts">{t.newAccount}</a></p>}</section>
      <section className="card"><h3>{t.accounts}</h3><p className="widget-context">{t.asOf}: {displayDate(date, locale)}</p>{accounts.map((account) => { const values = accountBalances(snapshot, account, date); return <div className="account-summary" key={account.id}><a href={`#transactions?account=${account.id}`}>{account.name}</a><div className="balance-stack">{values.map((value) => <Amount key={value.currency} value={value} locale={locale} display={moneyDisplay} />)}<ConvertedBalance values={values} currency={account.primaryCurrency} date={date} locale={locale} display={moneyDisplay} t={t} /></div></div>; })}{!accounts.length && <p className="empty">{t.empty}</p>}</section>
      <section className="card"><div className="section-heading"><div><h3>{t.recent}</h3><p className="widget-context">{t.asOf}: {displayDate(date, locale)}</p></div><a href="#transactions">{t.transactions} →</a></div>{snapshot.transactions.filter((item) => accountIds.has(item.accountId) && isActual(item, date)).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, 3).map((item) => <div className="account-summary" key={item.id}><div><strong>{item.description ?? t[item.transactionType]}</strong><p className="hint">{displayDate(item.transactionDate, locale)}</p></div><Amount value={item.originalAmount} locale={locale} display={moneyDisplay} /></div>)}{!snapshot.transactions.some((item) => accountIds.has(item.accountId) && isActual(item, date)) && <p className="empty">{t.empty}</p>}</section>
      <FxWidget base={snapshot.household.baseCurrency} quotes={quotes} date={date} t={t} locale={locale} />
    </div>
  </section>;
}
