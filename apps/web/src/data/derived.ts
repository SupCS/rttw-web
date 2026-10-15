import type { Account, AuditFields, Category, LedgerSnapshot, MoneyCurrencyCode, Transaction, WireMoney } from '@rttw/domain';
import type { Language } from '../i18n';

export function audit(userId: string, existing?: AuditFields): AuditFields {
  const now = new Date().toISOString();
  return { id: existing?.id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now,
    createdByUserId: existing?.createdByUserId ?? userId, updatedByUserId: userId,
    revision: (existing?.revision ?? 0) + 1, deletedAt: null };
}
export function isActual(transaction: Transaction, date: string): boolean {
  return !transaction.deletedAt && (transaction.status === 'confirmed' || transaction.status === 'fx_pending') && transaction.transactionDate <= date;
}
export function ledgerAccounts(snapshot: LedgerSnapshot, includeDeleted = false): Account[] {
  return snapshot.accounts.filter((account) => (includeDeleted || !account.deletedAt));
}
export function accountBalances(snapshot: LedgerSnapshot, account: Account, date: string): WireMoney[] {
  const totals = new Map<MoneyCurrencyCode, bigint>();
  for (const opening of account.openingBalances) totals.set(opening.currency, BigInt(opening.amountMinor));
  for (const transaction of snapshot.transactions) {
    if (transaction.accountId !== account.id || !isActual(transaction, date)) continue;
    const value = transaction.originalAmount;
    totals.set(value.currency, (totals.get(value.currency) ?? 0n) + BigInt(value.amountMinor));
  }
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() }));
}
export function balances(snapshot: LedgerSnapshot, date: string): WireMoney[] {
  const totals = new Map<MoneyCurrencyCode, bigint>();
  for (const account of ledgerAccounts(snapshot)) for (const value of accountBalances(snapshot, account, date)) totals.set(value.currency, (totals.get(value.currency) ?? 0n) + BigInt(value.amountMinor));
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() }));
}
export type ReportPeriod = string | { from: string; to: string };
function inPeriod(date: string, period: ReportPeriod): boolean { return typeof period === 'string' ? date.startsWith(period) : date >= period.from && date <= period.to; }
function included(transaction: Transaction, date: string, planned: boolean) { return planned ? !transaction.deletedAt && (transaction.status === 'planned' || transaction.transactionDate > date) : isActual(transaction, date); }
export function reportPeriod(kind: 'day' | 'week' | 'month' | 'year', anchor: string): { from: string; to: string } {
  const [year, month, day] = anchor.split('-').map(Number); const start = new Date(Date.UTC(year!, month! - 1, day!)); const end = new Date(start);
  if (kind === 'week') { const offset = (start.getUTCDay() + 6) % 7; start.setUTCDate(start.getUTCDate() - offset); end.setTime(start.getTime()); end.setUTCDate(end.getUTCDate() + 6); }
  if (kind === 'month') { start.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1, 0); }
  if (kind === 'year') { start.setUTCMonth(0, 1); end.setUTCMonth(11, 31); }
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
export function cashFlow(snapshot: LedgerSnapshot, period: ReportPeriod, date: string, reporting = false, reportAmounts?: Readonly<Record<string, WireMoney>>, reportCurrency = snapshot.ledger.baseCurrency, planned = false) {
  const ids = new Set(ledgerAccounts(snapshot, !planned).map((account) => account.id));
  const totals = new Map<MoneyCurrencyCode, { income: bigint; expense: bigint }>();
  let pending = 0;
  for (const transaction of snapshot.transactions) {
    if (!ids.has(transaction.accountId) || !included(transaction, date, planned) || !inPeriod(transaction.transactionDate, period) || transaction.transactionType === 'transfer') continue;
    const value = reporting ? (reportAmounts ? reportAmounts[transaction.id] ?? null : transaction.reportingAmount?.currency === reportCurrency ? transaction.reportingAmount : null) : transaction.originalAmount;
    if (!value) { pending++; continue; }
    const total = totals.get(value.currency) ?? { income: 0n, expense: 0n };
    const amount = BigInt(value.amountMinor);
    if (amount > 0n) total.income += amount; else total.expense -= amount;
    totals.set(value.currency, total);
  }
  return { totals: [...totals].map(([currency, total]) => ({ currency, ...total })), pending };
}
export function categoryLabel(category: Category, categories: Category[], language: Language): string {
  const parent = categories.find((item) => item.id === category.parentId);
  return `${parent ? `${parent.names[language]} / ` : ''}${category.names[language]}`;
}
export function categoryRollup(snapshot: LedgerSnapshot, period: ReportPeriod, date: string, reportAmounts?: Readonly<Record<string, WireMoney>>, planned = false) {
  const ids = new Set(ledgerAccounts(snapshot, !planned).map((account) => account.id));
  const totals = new Map<string, { categoryId: string | null; currency: MoneyCurrencyCode; amount: bigint; children: Map<string, { categoryId: string | null; amount: bigint }> }>();
  function add(categoryId: string | null, money: WireMoney) {
    const category = snapshot.categories.find((item) => item.id === categoryId);
    const rollup = category?.parentId ?? categoryId;
    const key = `${rollup ?? ''}:${money.currency}`;
    const value = totals.get(key) ?? { categoryId: rollup, currency: money.currency, amount: 0n, children: new Map() };
    value.amount -= BigInt(money.amountMinor);
    const child = value.children.get(categoryId ?? '') ?? { categoryId, amount: 0n }; child.amount -= BigInt(money.amountMinor); value.children.set(categoryId ?? '', child); totals.set(key, value);
  }
  for (const transaction of snapshot.transactions) {
    if (!ids.has(transaction.accountId) || !included(transaction, date, planned) || !inPeriod(transaction.transactionDate, period) || transaction.transactionType !== 'expense') continue;
    const reporting = reportAmounts?.[transaction.id]; if (reportAmounts && !reporting) continue;
    const splits = snapshot.splits.filter((split) => split.transactionId === transaction.id && !split.deletedAt);
    if (splits.length) {
      let allocated = 0n;
      splits.forEach((split, index) => {
        const amount = reporting ? index === splits.length - 1 ? BigInt(reporting.amountMinor) - allocated : BigInt(reporting.amountMinor) * BigInt(split.amount.amountMinor) / BigInt(transaction.originalAmount.amountMinor) : BigInt(split.amount.amountMinor);
        allocated += amount; add(split.categoryId, { currency: reporting?.currency ?? split.amount.currency, amountMinor: amount.toString() });
      });
    } else add(transaction.categoryId, reporting ?? transaction.originalAmount);
  }
  return [...totals.values()].sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1);
}
