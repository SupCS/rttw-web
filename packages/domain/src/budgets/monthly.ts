import type { LedgerSnapshot, MonthlyBudget, Transaction, TransactionSplit, WireMoney } from '../ledger/types.js';

export type BudgetProgress = Readonly<{
  limitMinor: bigint;
  spentMinor: bigint;
  remainingMinor: bigint;
  progressPercent: number;
  missingCount: number;
  state: 'comfortable' | 'near' | 'reached' | 'over' | 'incomplete';
}>;

export function budgetTransactions(snapshot: LedgerSnapshot, month: string, asOf: string): Transaction[] {
  const accounts = new Set(snapshot.accounts.map(account => account.id));
  return snapshot.transactions.filter(transaction => transaction.ledgerId === snapshot.ledger.id && accounts.has(transaction.accountId)
    && !transaction.deletedAt && ['confirmed', 'fx_pending'].includes(transaction.status)
    && transaction.transactionDate.startsWith(`${month}-`) && transaction.transactionDate <= asOf
    && (transaction.transactionType === 'expense' || transaction.transactionType === 'refund'));
}

/** Report conversions are temporary; persisted money and FX snapshots are never changed. */
export function calculateMonthlyBudget(snapshot: LedgerSnapshot, budget: MonthlyBudget, asOf: string, amounts: Readonly<Record<string, WireMoney>> = {}) {
  if (budget.ledgerId !== snapshot.ledger.id) throw new Error('Budget belongs to another ledger');
  const categories = new Map(snapshot.categories.map(category => [category.id, category]));
  const splitsByTransaction = new Map<string, TransactionSplit[]>();
  for (const split of snapshot.splits) {
    if (split.deletedAt) continue;
    const list = splitsByTransaction.get(split.transactionId) ?? [];
    list.push(split); splitsByTransaction.set(split.transactionId, list);
  }
  const totals = new Map(budget.categoryLimits.map(limit => [limit.categoryId, { spent: 0n, missing: 0 }]));
  let total = 0n;
  let missing = 0;
  function matches(categoryId: string | null): Set<string> {
    const result = new Set<string>();
    while (categoryId && !result.has(categoryId)) {
      result.add(categoryId);
      categoryId = categories.get(categoryId)?.parentId ?? null;
    }
    return result;
  }
  for (const transaction of budgetTransactions(snapshot, budget.month, asOf)) {
    const splits = splitsByTransaction.get(transaction.id) ?? [];
    const source = BigInt(transaction.originalAmount.amountMinor);
    if (source === 0n) continue;
    const converted = transaction.originalAmount.currency === budget.currency ? transaction.originalAmount
      : transaction.reportingAmount?.currency === budget.currency ? transaction.reportingAmount
      : amounts[transaction.id]?.currency === budget.currency ? amounts[transaction.id] : undefined;
    if (!converted) {
      missing++;
      const affected = new Set((splits.length ? splits.map(split => split.categoryId) : [transaction.categoryId]).flatMap(id => [...matches(id)]));
      for (const id of affected) { const sum = totals.get(id); if (sum) sum.missing++; }
      continue;
    }
    const value = BigInt(converted.amountMinor);
    total -= value;
    if (!splits.length) {
      for (const id of matches(transaction.categoryId)) { const sum = totals.get(id); if (sum) sum.spent -= value; }
    } else {
      let allocated = 0n;
      splits.forEach((split, index) => {
        const amount = index === splits.length - 1 ? value - allocated : value * BigInt(split.amount.amountMinor) / source;
        allocated += amount;
        for (const id of matches(split.categoryId)) { const sum = totals.get(id); if (sum) sum.spent -= amount; }
      });
    }
  }
  function progress(limit: string, spent: bigint, pending: number): BudgetProgress {
    const limitMinor = BigInt(limit);
    const spentMinor = spent < 0n ? 0n : spent;
    const ratio = limitMinor > 0n ? spentMinor * 10000n / limitMinor : 0n;
    return { limitMinor, spentMinor, remainingMinor: limitMinor - spentMinor,
      progressPercent: Number(ratio > 10000n ? 10000n : ratio) / 100,
      missingCount: pending,
      state: spentMinor > limitMinor ? 'over' : spentMinor === limitMinor ? 'reached' : pending ? 'incomplete' : ratio >= 8000n ? 'near' : 'comfortable' };
  }
  return {
    overall: budget.totalLimitMinor === null ? null : progress(budget.totalLimitMinor, total, missing),
    categories: budget.categoryLimits.map(limit => ({ categoryId: limit.categoryId, ...progress(limit.limitMinor, totals.get(limit.categoryId)?.spent ?? 0n, totals.get(limit.categoryId)?.missing ?? 0) })),
    missingCount: missing,
  };
}
