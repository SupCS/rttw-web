import { describe, expect, it } from 'vitest';
import { parseMajorAmount, type Account, type AuditFields, type Category, type LedgerSnapshot, type Transaction } from '@rttw/domain';
import { accountBalances, balances, cashFlow, categoryRollup, isActual, reportPeriod } from './derived';
import { convertBalance } from './reporting';
import { signedMajorInput } from '../components/shared';

const stamp: AuditFields = { id: 'id', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdByMemberId: 'me', updatedByMemberId: 'me', revision: 1, deletedAt: null };
const account = (id: string, fields: Partial<Account> = {}): Account => ({ ...stamp, id, householdId: 'home', ownershipScope: 'personal', ownerMemberId: 'me', name: id, accountType: 'current', primaryCurrency: 'USD', openingBalances: [{ amountMinor: '10000', currency: 'USD' }], isArchived: false, ...fields });
const transaction = (id: string, fields: Partial<Transaction> = {}): Transaction => ({ ...stamp, id, householdId: 'home', accountId: 'a', memberId: 'me', categoryId: null, transactionType: 'expense', transactionDate: '2026-10-10', postingDate: null, source: 'manual', status: 'confirmed', originalAmount: { amountMinor: '-1000', currency: 'USD' }, reportingAmount: { amountMinor: '-1000', currency: 'USD' }, fxSnapshot: null, description: null, notes: null, ...fields });
const category = (id: string, fields: Partial<Category> = {}): Category => ({ ...stamp, id, householdId: 'home', parentId: null, applicability: 'expense', systemKey: null, names: { en: id, uk: id, ru: id }, icon: null, colorToken: null, iconColor: null, isArchived: false, ...fields });
const snapshot = (fields: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({ household: { ...stamp, id: 'home', name: 'Home', baseCurrency: 'USD' }, member: { ...stamp, id: 'me', householdId: 'home', userId: 'user', displayName: 'Member', role: 'owner', membershipStatus: 'active' }, accounts: [account('a'), account('b', { ownershipScope: 'shared', ownerMemberId: null })], categories: [], transactions: [], splits: [], transferLinks: [], recurringRules: [], ...fields });

describe('ledger report arithmetic', () => {
  it('uses inclusive day/week/month/year boundaries and keeps planned flow separate', () => {
    expect(reportPeriod('day', '2026-10-14')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(reportPeriod('week', '2026-10-14')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(reportPeriod('month', '2024-02-29')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(reportPeriod('year', '2026-10-14')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    const ledger = snapshot({ transactions: [transaction('actual'), transaction('planned', { transactionDate: '2026-10-20', status: 'planned' })] });
    expect(cashFlow(ledger, 'household', reportPeriod('month', '2026-10-14'), '2026-10-14').totals[0]?.expense).toBe(1000n);
    expect(cashFlow(ledger, 'household', reportPeriod('month', '2026-10-14'), '2026-10-14', false, undefined, 'USD', true).totals[0]?.expense).toBe(1000n);
    expect(balances(ledger, 'household', '2026-10-14')[0]?.amountMinor).toBe('19000');
  });
  it('keeps balances all-time and cash flow monthly; excludes transfers, future, planned and review from actuals', () => {
    const ledger = snapshot({ transactions: [transaction('old', { transactionDate: '2026-09-01' }), transaction('expense'), transaction('income', { transactionType: 'income', originalAmount: { amountMinor: '2000', currency: 'USD' } }), transaction('debit', { transactionType: 'transfer', originalAmount: { amountMinor: '-500', currency: 'USD' } }), transaction('credit', { transactionType: 'transfer', accountId: 'b', originalAmount: { amountMinor: '500', currency: 'USD' } }), transaction('future', { transactionDate: '2026-11-01' }), transaction('planned', { status: 'planned' }), transaction('review', { status: 'review' })] });
    expect(balances(ledger, 'household', '2026-10-14')).toEqual([{ currency: 'USD', amountMinor: '20000' }]);
    expect(cashFlow(ledger, 'household', '2026-10', '2026-10-14').totals).toEqual([{ currency: 'USD', income: 2000n, expense: 1000n }]);
    expect(isActual(transaction('review', { status: 'review' }), '2026-10-14')).toBe(false);
  });
  it('scopes by account ownership and excludes archived accounts from dashboards', () => {
    const ledger = snapshot({ accounts: [account('a'), account('b', { ownerMemberId: 'other' }), account('shared', { ownershipScope: 'shared', ownerMemberId: null }), account('archived', { isArchived: true })], transactions: [transaction('different-member', { memberId: 'other' })] });
    expect(balances(ledger, 'personal', '2026-10-14')).toEqual([{ currency: 'USD', amountMinor: '9000' }]);
    expect(balances(ledger, 'household', '2026-10-14')).toEqual([{ currency: 'USD', amountMinor: '29000' }]);
  });
  it('never mixes original or reporting currencies without explicit conversions', () => {
    const ledger = snapshot({ transactions: [transaction('usd'), transaction('eur', { originalAmount: { amountMinor: '-2000', currency: 'EUR' }, reportingAmount: { amountMinor: '-1800', currency: 'EUR' } })] });
    expect(cashFlow(ledger, 'household', '2026-10', '2026-10-14').totals).toEqual([{ currency: 'USD', income: 0n, expense: 1000n }, { currency: 'EUR', income: 0n, expense: 2000n }]);
    expect(cashFlow(ledger, 'household', '2026-10', '2026-10-14', true)).toEqual({ totals: [{ currency: 'USD', income: 0n, expense: 1000n }], pending: 1 });
    const converted = { usd: { amountMinor: '-1000', currency: 'USD' as const }, eur: { amountMinor: '-2200', currency: 'USD' as const } };
    expect(cashFlow(ledger, 'household', '2026-10', '2026-10-14', true, converted).totals).toEqual([{ currency: 'USD', income: 0n, expense: 3200n }]);
    expect(ledger.transactions[1]?.reportingAmount).toEqual({ amountMinor: '-1800', currency: 'EUR' });
  });
  it('rolls up split spending and direct parent spending with exact converted allocation', () => {
    const ledger = snapshot({ categories: [category('food'), category('groceries', { parentId: 'food' }), category('cafe', { parentId: 'food' })], transactions: [transaction('split'), transaction('direct', { categoryId: 'food', originalAmount: { currency: 'USD', amountMinor: '-100' } })], splits: [{ ...stamp, id: 's1', householdId: 'home', transactionId: 'split', categoryId: 'groceries', amount: { currency: 'USD', amountMinor: '-333' } }, { ...stamp, id: 's2', householdId: 'home', transactionId: 'split', categoryId: 'cafe', amount: { currency: 'USD', amountMinor: '-667' } }] });
    const original = categoryRollup(ledger, 'household', '2026-10', '2026-10-14')[0]!;
    expect(original.amount).toBe(1100n); expect(original.children.get('food')?.amount).toBe(100n); expect(original.children.get('groceries')?.amount).toBe(333n);
    const converted = categoryRollup(ledger, 'household', '2026-10', '2026-10-14', { split: { currency: 'JPY', amountMinor: '-101' }, direct: { currency: 'JPY', amountMinor: '-10' } })[0]!;
    expect(converted.currency).toBe('JPY'); expect(converted.amount).toBe(111n); expect([...converted.children.values()].reduce((sum, child) => sum + child.amount, 0n)).toBe(111n);
  });
  it('preserves negative opening balances during an edit round trip and uses bigint for large balances', () => {
    const opening = { currency: 'KWD' as const, amountMinor: '-123456' };
    expect(signedMajorInput(opening)).toBe('-123.456'); expect(parseMajorAmount(signedMajorInput(opening), 'KWD').amountMinor).toBe(-123456n);
    const huge = account('a', { openingBalances: [{ currency: 'USD', amountMinor: '9007199254740993' }] });
    expect(accountBalances(snapshot({ accounts: [huge], transactions: [transaction('e')] }), huge, '2026-10-14')).toEqual([{ currency: 'USD', amountMinor: '9007199254739993' }]);
  });
  it('shows a converted account total only if every currency has an explicit rate', () => {
    const values = [{ currency: 'USD' as const, amountMinor: '10000' }, { currency: 'EUR' as const, amountMinor: '-5000' }];
    expect(convertBalance(values, 'USD', [])).toBeNull();
    expect(convertBalance(values, 'USD', [{ base: 'EUR', quote: 'USD', rateDecimal: '1.10', requestedDate: '2026-10-14', effectiveDate: '2026-10-14', provider: 'manual' }])).toEqual({ currency: 'USD', amountMinor: '4500' });
  });
});
