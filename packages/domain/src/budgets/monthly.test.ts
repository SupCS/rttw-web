import { describe, expect, it } from 'vitest';
import type { Account, Category, LedgerSnapshot, MonthlyBudget, Transaction } from '../ledger/types.js';
import { calculateMonthlyBudget } from './monthly.js';

const audit = { id: 'id', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', createdByUserId: 'user', updatedByUserId: 'user', revision: 1, deletedAt: null };
const account: Account = { ...audit, id: 'account', ledgerId: 'ledger', name: 'Cash', accountType: 'cash', primaryCurrency: 'USD', openingBalances: [{ currency: 'USD', amountMinor: '99999999' }], isArchived: false };
const category = (id: string, parentId: string | null = null): Category => ({ ...audit, id, ledgerId: 'ledger', parentId, applicability: 'both', systemKey: null, names: { en: id, uk: id, ru: id }, icon: null, colorToken: null, iconColor: null, isArchived: false });
const transaction = (id: string, fields: Partial<Transaction> = {}): Transaction => ({ ...audit, id, ledgerId: 'ledger', accountId: 'account', categoryId: 'child', transactionType: 'expense', transactionDate: '2026-10-03', postingDate: null, source: 'manual', status: 'confirmed', originalAmount: { currency: 'USD', amountMinor: '-100' }, reportingAmount: { currency: 'USD', amountMinor: '-100' }, fxSnapshot: null, description: null, notes: null, ...fields });
const snapshot = (transactions: Transaction[] = []): LedgerSnapshot => ({ ledger: { ...audit, id: 'ledger', baseCurrency: 'USD' }, userId: 'user', accounts: [account], categories: [category('parent'), category('child', 'parent'), category('other')], transactions, splits: [], transferLinks: [], recurringRules: [], budgets: [] });
const budget: MonthlyBudget = { ...audit, ledgerId: 'ledger', month: '2026-10', currency: 'USD', totalLimitMinor: '1000', categoryLimits: [{ categoryId: 'parent', limitMinor: '500' }, { categoryId: 'child', limitMinor: '400' }] };

describe('monthly budget spending', () => {
  it('counts actual spending and refunds once; ignores balances, transfers, income and future records', () => {
    const state = snapshot([transaction('expense'), transaction('fee', { categoryId: null }), transaction('refund', { transactionType: 'refund', originalAmount: { currency: 'USD', amountMinor: '50' } }),
      transaction('transfer', { transactionType: 'transfer' }), transaction('income', { transactionType: 'income' }), transaction('debt', { transactionType: 'debt_payment' }), transaction('adjustment', { transactionType: 'adjustment' }), transaction('future', { transactionDate: '2026-10-30' }), transaction('planned', { status: 'planned' }), transaction('review', { status: 'review' }), transaction('deleted', { deletedAt: audit.createdAt }), transaction('last-month', { transactionDate: '2026-09-30' })]);
    const result = calculateMonthlyBudget(state, budget, '2026-10-16');
    expect(result.overall?.spentMinor).toBe(150n);
    expect(result.categories.map(item => item.spentMinor)).toEqual([50n, 50n]);
    expect(result.overall?.remainingMinor).toBe(850n);
    state.accounts[0] = { ...account, deletedAt: audit.createdAt };
    expect(calculateMonthlyBudget(state, budget, '2026-10-16').overall?.spentMinor).toBe(150n);
  });
  it('allocates converted split rounding exactly and rolls children into parents', () => {
    const tx = transaction('split', { categoryId: null, originalAmount: { currency: 'EUR', amountMinor: '-3' }, reportingAmount: { currency: 'USD', amountMinor: '-100' } });
    const state = snapshot([tx]);
    state.splits.push({ ...audit, id: 's1', ledgerId: 'ledger', transactionId: tx.id, categoryId: 'child', amount: { currency: 'EUR', amountMinor: '-1' } }, { ...audit, id: 's2', ledgerId: 'ledger', transactionId: tx.id, categoryId: 'other', amount: { currency: 'EUR', amountMinor: '-2' } });
    const plan = { ...budget, categoryLimits: [...budget.categoryLimits, { categoryId: 'other', limitMinor: '100' }] };
    const result = calculateMonthlyBudget(state, plan, '2026-10-16');
    expect(result.overall?.spentMinor).toBe(100n);
    expect(result.categories.map(item => item.spentMinor)).toEqual([33n, 33n, 67n]);
  });
  it('marks missing FX incomplete and never mixes currencies or mutates stored snapshots', () => {
    const tx = transaction('eur', { originalAmount: { currency: 'EUR', amountMinor: '-100' }, reportingAmount: null, status: 'fx_pending' });
    const state = snapshot([tx]); const before = structuredClone(state);
    const partial = calculateMonthlyBudget(state, budget, '2026-10-16', { eur: { currency: 'GEL', amountMinor: '-300' } });
    expect(partial.overall?.state).toBe('incomplete'); expect(partial.overall?.missingCount).toBe(1);
    expect(partial.categories.map(item => item.missingCount)).toEqual([1, 1]);
    const resolved = calculateMonthlyBudget(state, budget, '2026-10-16', { eur: { currency: 'USD', amountMinor: '-110' } });
    expect(resolved.overall?.spentMinor).toBe(110n); expect(resolved.missingCount).toBe(0);
    expect(state).toEqual(before);
  });
  it('keeps large bigint limits exact and distinguishes near, reached and over budget', () => {
    for (const [spent, status] of [['800', 'near'], ['1000', 'reached'], ['1001', 'over']] as const) {
      const result = calculateMonthlyBudget(snapshot([transaction('expense', { originalAmount: { currency: 'USD', amountMinor: `-${spent}` } })]), budget, '2026-10-16');
      expect(result.overall?.state).toBe(status);
    }
    const huge = { ...budget, totalLimitMinor: '9007199254740993' };
    const result = calculateMonthlyBudget(snapshot([transaction('expense')]), huge, '2026-10-16');
    expect(result.overall?.remainingMinor).toBe(9007199254740893n);
    const refund = snapshot([transaction('refund', { transactionType: 'refund', originalAmount: { currency: 'USD', amountMinor: '500' } })]);
    expect(calculateMonthlyBudget(refund, budget, '2026-10-16').overall?.remainingMinor).toBe(1000n);
  });
});
