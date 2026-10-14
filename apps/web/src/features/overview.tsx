import { useState } from 'react';
import type { MoneyCurrencyCode } from '@rttw/domain';
import { balances, cashFlow, categoryRollup, scopedAccounts, accountBalances, isActual, reportPeriod } from '../data/derived';
import { useReportAmounts } from '../data/reporting';
import { displayDate, today } from '../format';
import { Amount, CurrencySelect, Field, type FeatureProps } from '../components/shared';
import { ConvertedBalance, FxWidget } from './overview-fx';
import { CategoryVisualization, CategoryViewSwitch, type CategoryView } from './category-visualization';
import { Forecast } from './forecast';

type Scope = 'personal' | 'household';
type ScopedProps = FeatureProps & { scope: Scope };

export function Overview({ scope, onScope, enabledCurrencies, ...props }: FeatureProps & {
  scope: Scope; onScope: (scope: Scope) => void; enabledCurrencies: MoneyCurrencyCode[];
}) {
  const { snapshot, t } = props;
  return <>
    <div className="section-heading"><div><p className="eyebrow">{snapshot.household.name}</p><h1>{t.overview}</h1></div><a className="button primary" href="#transactions">+ {t.newTransaction}</a></div>
    <div className="overview-scope"><span>{t.scope}</span><div className="segmented-control" role="group" aria-label={t.scope}>
      {(['personal', 'household'] as const).map((value) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => onScope(value)}>{t[value]}</button>)}
    </div><p className="hint">{t.overviewScopeHint}</p></div>
    <PeriodReports {...props} scope={scope} />
    <BalanceSnapshot {...props} scope={scope} enabledCurrencies={enabledCurrencies} />
  </>;
}

function PeriodReports({ scope, ...props }: ScopedProps) {
  const { snapshot, t, locale, language, moneyDisplay } = props;
  const [anchor, setAnchor] = useState(today());
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [showPlanned, setShowPlanned] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportCurrency, setReportCurrency] = useState(snapshot.household.baseCurrency);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<CategoryView>('listView');
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
  return <section className="overview-group overview-reports" aria-labelledby="overview-reports-title">
    <header className="overview-group-header">
      <div><h2 id="overview-reports-title">{t.periodReports}</h2><p className="hint">{t.reportPeriodHint}</p></div>
      <div className="report-period-controls">
        <div className="segmented-control" role="group" aria-label={t.period}>{(['day', 'week', 'month', 'year'] as const).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{t[value]}</button>)}</div>
        <Field label={period === 'month' ? t.month : t.dateInPeriod}><input type={period === 'month' ? 'month' : 'date'} value={period === 'month' ? anchor.slice(0, 7) : anchor} onChange={(event) => { if (event.target.value) setAnchor(period === 'month' ? `${event.target.value}-01` : event.target.value); }} /></Field>
      </div>
      <div className="report-context"><strong>{periodLabel}</strong><span>{displayDate(range.from, locale)} → {displayDate(range.to, locale)}</span><span>{reporting ? reportCurrency : t.originalCurrencies}</span></div>
      <div className="report-options"><label className="check"><input type="checkbox" checked={reporting} onChange={(event) => setReporting(event.target.checked)} />{t.reportCurrency}</label>{reporting && <Field label={t.currency}><CurrencySelect value={reportCurrency} onChange={setReportCurrency} /></Field>}<label className="check"><input type="checkbox" checked={showPlanned} onChange={(event) => setShowPlanned(event.target.checked)} />{t.showPlanned}</label></div>
      {reporting && <><p className="hint">{t.reportFxHint}</p>{conversions.loading && <p role="status">{t.loading}</p>}{!conversions.loading && flow.pending > 0 && <button type="button" onClick={() => setRetry((value) => value + 1)}>{t.retry}</button>}{!!conversions.usedRates.length && <details><summary>{t.fx}</summary>{conversions.usedRates.map((rate) => <p className="hint" key={`${rate.base}:${rate.quote}:${rate.requestedDate}`}>1 {rate.base} = {rate.rateDecimal} {rate.quote} · {rate.provider} · {rate.requestedDate} → {rate.effectiveDate}</p>)}</details>}</>}
    </header>
    <div className="overview-widget-grid">
      <section className="card"><div className="section-heading"><div><h3>{t.cashFlowTitle}</h3><p className="widget-context">{periodLabel}</p></div></div>
        {flow.pending > 0 && <p className="notice">{t.fx_pending}: {flow.pending}</p>}
        <div className="table-wrap"><table><thead><tr><th>{t.currency}</th><th>{t.income}</th><th>{t.expense}</th><th>{t.net}</th></tr></thead><tbody>{flow.totals.map((value) => <tr key={value.currency}><th>{value.currency}</th><td className="positive"><Amount value={{ currency: value.currency, amountMinor: value.income.toString() }} locale={locale} display={moneyDisplay} /></td><td className="negative"><Amount value={{ currency: value.currency, amountMinor: value.expense.toString() }} locale={locale} display={moneyDisplay} /></td><td><Amount value={{ currency: value.currency, amountMinor: (value.income - value.expense).toString() }} locale={locale} display={moneyDisplay} /></td></tr>)}</tbody></table></div>{!flow.totals.length && <p className="empty">{t.empty}</p>}
      </section>
      <section className="card"><div className="section-heading"><div><h3>{t.expenseCategories}</h3><p className="widget-context">{periodLabel}</p></div><CategoryViewSwitch value={view} onChange={setView} t={t} /></div><p className="hint">{t.rollupHint}</p><CategoryVisualization rows={rollup} categories={snapshot.categories} language={language} locale={locale} display={moneyDisplay} t={t} view={view} />{!rollup.length && <p className="empty">{t.empty}</p>}</section>
    </div>
    {showPlanned && <Forecast {...props} scope={scope} period={range} reportCurrency={reportCurrency} reporting={reporting} />}
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
