import { useState } from 'react';
import { buildUpcomingItems, getRecurringPayment, addDays, type MoneyCurrencyCode } from '@rttw/domain';
import { cashFlow, categoryRollup, scopedAccounts, type ReportPeriod } from '../data/derived';
import { useReportAmounts } from '../data/reporting';
import { displayDate, today } from '../format';
import { Amount, type FeatureProps } from '../components/shared';
import { CategoryVisualization, CategoryViewSwitch, type CategoryView } from './category-visualization';

export function Forecast({ scope, period, reportCurrency, reporting, ...props }: FeatureProps & { scope: 'personal' | 'household'; period: Exclude<ReportPeriod, string>; reportCurrency: MoneyCurrencyCode; reporting: boolean }) {
  const { snapshot, t, locale, language, moneyDisplay } = props;
  const [view, setView] = useState<CategoryView>('listView');
  const templateIds = new Set(snapshot.recurringRules.filter((rule) => rule.payment && rule.templateTransactionId || !rule.deletedAt && rule.isActive).map((rule) => rule.templateTransactionId));
  const upcoming = period.to >= today() ? buildUpcomingItems(snapshot.recurringRules.filter((rule) => !rule.deletedAt), snapshot.transactions.filter((item) => !item.deletedAt), period.from > today() ? addDays(period.from, -1) : today(), period.to) : [];
  const transactions = [...snapshot.transactions.filter((item) => !item.deletedAt && !templateIds.has(item.id) && (item.status === 'planned' || item.transactionDate > today()) && item.transactionDate >= period.from && item.transactionDate <= period.to), ...upcoming.map((item) => ({ ...item.transaction, id: `${item.rule.id}:${item.occurrenceDate}`, transactionDate: item.occurrenceDate, postingDate: null, status: 'planned' as const, reportingAmount: null, fxSnapshot: null }))];
  const splits = [...snapshot.splits, ...upcoming.flatMap((item) => (getRecurringPayment(item.rule, snapshot.transactions, snapshot.splits)?.splits ?? []).map((split, index) => ({
    id: `${item.rule.id}:${item.occurrenceDate}:split:${index}`, householdId: snapshot.household.id, transactionId: `${item.rule.id}:${item.occurrenceDate}`,
    createdAt: item.rule.createdAt, updatedAt: item.rule.updatedAt, createdByMemberId: item.rule.createdByMemberId, updatedByMemberId: item.rule.updatedByMemberId,
    revision: 1, deletedAt: null, categoryId: split.categoryId, amount: split.amount,
  })))];
  const preview = { ...snapshot, transactions, splits };
  const accountIds = new Set(scopedAccounts(snapshot, scope).map((item) => item.id));
  const visible = transactions.filter((item) => accountIds.has(item.accountId));
  const converted = useReportAmounts(visible, reportCurrency, reporting, 0);
  const flow = cashFlow(preview, scope, period, today(), reporting, reporting ? converted.amounts : undefined, reportCurrency, true);
  const categories = categoryRollup(preview, scope, period, today(), reporting ? converted.amounts : undefined, true);
  return <section className="card"><h3>{t.forecast}</h3><p className="widget-context">{displayDate(period.from, locale)} → {displayDate(period.to, locale)}</p><p className="hint">{t.forecastHint}</p>{converted.loading && <p role="status">{t.loading}</p>}{flow.pending > 0 && <p className="notice">{t.fx_pending}: {flow.pending}</p>}
    <div className="table-wrap"><table><thead><tr><th>{t.currency}</th><th>{t.income}</th><th>{t.expense}</th><th>{t.net}</th></tr></thead><tbody>{flow.totals.map((value) => <tr key={value.currency}><th>{value.currency}</th><td><Amount value={{ currency: value.currency, amountMinor: value.income.toString() }} locale={locale} display={moneyDisplay} /></td><td><Amount value={{ currency: value.currency, amountMinor: value.expense.toString() }} locale={locale} display={moneyDisplay} /></td><td><Amount value={{ currency: value.currency, amountMinor: (value.income - value.expense).toString() }} locale={locale} display={moneyDisplay} /></td></tr>)}</tbody></table></div>
    <div className="section-heading forecast-category-heading"><h3>{t.expenseCategories}</h3><CategoryViewSwitch value={view} onChange={setView} t={t} /></div>
    <CategoryVisualization rows={categories} categories={snapshot.categories} language={language} locale={locale} display={moneyDisplay} t={t} view={view} />
    <h3>{t.upcoming}</h3>{visible.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)).slice(0, 10).map((item) => <div className="account-summary" key={item.id}><div><strong>{item.description ?? t[item.transactionType]}</strong><p className="hint">{displayDate(item.transactionDate, locale)} · {t.planned}</p></div><Amount value={item.originalAmount} locale={locale} display={moneyDisplay} /></div>)}{!visible.length && <p className="empty">{t.empty}</p>}<a href="#recurring">{t.recurring} →</a>
  </section>;
}
