import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase } from 'pg';
import type { Category, MonthlyBudget } from '@rttw/domain';
import { createLocalDatabasePool } from '../src/database/local.js';
import { migrationOptions } from '../src/database/migrations.js';
import { LedgerService } from '../src/ledger/service.js';

const stamp = () => ({ id: randomUUID(), createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', createdByUserId: null, updatedByUserId: null, revision: 1, deletedAt: null });

test('monthly budgets validate limits, protect ownership and survive editing, merging and backup restore', async t => {
  const pool = createLocalDatabasePool(new PGlite()); t.after(() => pool.end());
  await runner({ ...migrationOptions, dbClient: pool as unknown as ClientBase });
  const ledger = new LedgerService(pool);
  async function actor() {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test')", [userId, `${userId}@example.invalid`]);
    return userId;
  }
  const userId = await actor(), otherUserId = await actor();
  let state = await ledger.getSnapshot(userId);
  const ledgerId = state.ledger.id;
  const category = (id: string): Category => ({ ...stamp(), id, ledgerId, parentId: null, applicability: 'expense', systemKey: null, names: { en: id, uk: id, ru: id }, icon: null, colorToken: null, iconColor: null, isArchived: false });
  const alpha = category('alpha'), beta = category('beta');
  for (const item of [alpha, beta]) state = await ledger.execute(userId, { type: 'category.save', category: item, expectedRevision: 0 });
  const plan: MonthlyBudget = { ...stamp(), ledgerId, month: '2026-10', currency: 'USD', totalLimitMinor: '9007199254740993', categoryLimits: [{ categoryId: alpha.id, limitMinor: '1000' }, { categoryId: beta.id, limitMinor: '2000' }] };
  const requestId = randomUUID();
  state = await ledger.execute(userId, { type: 'budget.save', budget: plan, expectedRevision: 0 }, requestId);
  assert.equal(state.budgets[0]?.createdByUserId, userId);
  assert.equal(state.budgets[0]?.totalLimitMinor, '9007199254740993');
  const duplicateRetry = await ledger.execute(userId, { type: 'budget.save', budget: plan, expectedRevision: 0 }, requestId);
  assert.equal(duplicateRetry.budgets.length, 1);
  await assert.rejects(() => ledger.execute(otherUserId, { type: 'budget.save', budget: plan }), { code: 'cross_ledger_reference', statusCode: 403 });
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, id: randomUUID() } }), { code: 'budget_month_exists', statusCode: 409 });
  for (const totalLimitMinor of ['0', '-1', '1.5', 'abc', '9223372036854775808']) {
    await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, id: randomUUID(), month: '2026-11', totalLimitMinor } }), { code: 'invalid_ledger_command' });
  }
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, id: randomUUID(), month: '2026-13' } }), { code: 'invalid_ledger_command' });
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, id: randomUUID(), month: '2026-11', totalLimitMinor: null, categoryLimits: [] } }), { code: 'invalid_ledger_command' });
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, id: randomUUID(), month: '2026-11', categoryLimits: [plan.categoryLimits[0], plan.categoryLimits[0]] } }), { code: 'invalid_ledger_command' });
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, id: randomUUID(), month: '2026-11', categoryLimits: [{ categoryId: 'foreign-category', limitMinor: '100' }] } }), { code: 'budget_category_invalid' });
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...plan, totalLimitMinor: '10000' }, expectedRevision: 0 }), { code: 'revision_conflict' });
  state = await ledger.execute(userId, { type: 'budget.save', budget: { ...state.budgets[0]!, totalLimitMinor: '10000' }, expectedRevision: 1 });
  assert.equal(state.budgets[0]?.revision, 2);
  const account = { ...stamp(), ledgerId, name: 'Budget cash', accountType: 'cash', primaryCurrency: 'USD', openingBalances: [{ currency: 'USD', amountMinor: '10000' }], isArchived: false };
  state = await ledger.execute(userId, { type: 'account.save', account, expectedRevision: 0 });
  const transaction = { ...stamp(), ledgerId, accountId: account.id, categoryId: alpha.id, transactionType: 'expense', transactionDate: '2026-10-01', postingDate: null, source: 'manual', status: 'confirmed', originalAmount: { currency: 'USD', amountMinor: '-123' }, reportingAmount: { currency: 'USD', amountMinor: '-123' }, fxSnapshot: null, description: null, notes: null };
  state = await ledger.execute(userId, { type: 'transaction.save', transaction, splits: [], expectedRevision: 0 });
  const original = structuredClone(state.transactions[0]);
  state = await ledger.settings(userId, 'EUR');
  assert.equal(state.budgets[0]?.currency, 'USD'); assert.deepEqual(state.transactions[0], original);
  // A rejected merge must roll back transaction remapping as well as the limits.
  const beforeMerge = state.budgets[0]!;
  state = await ledger.execute(userId, { type: 'budget.save', budget: { ...beforeMerge, categoryLimits: [{ categoryId: alpha.id, limitMinor: '9223372036854775807' }, { categoryId: beta.id, limitMinor: '1' }] }, expectedRevision: beforeMerge.revision });
  await assert.rejects(() => ledger.execute(userId, { type: 'category.merge', sourceCategoryId: alpha.id, targetCategoryId: beta.id, expectedRevision: 1 }), { code: 'budget_limit_overflow' });
  assert.deepEqual((await ledger.getSnapshot(userId)).transactions[0], original);
  state = await ledger.execute(userId, { type: 'budget.save', budget: { ...state.budgets[0]!, categoryLimits: plan.categoryLimits }, expectedRevision: state.budgets[0]!.revision });
  await assert.rejects(() => ledger.execute(userId, { type: 'category.save', category: { ...beta, applicability: 'income' }, expectedRevision: 1 }), { code: 'category_has_budget' });
  state = await ledger.execute(userId, { type: 'category.merge', sourceCategoryId: alpha.id, targetCategoryId: beta.id, expectedRevision: 1 });
  assert.deepEqual(state.budgets[0]?.categoryLimits, [{ categoryId: beta.id, limitMinor: '3000' }]);
  assert.equal(state.transactions[0]?.originalAmount.amountMinor, '-123'); assert.equal(state.transactions[0]?.categoryId, beta.id);
  const backup = await ledger.exportBackup(userId);
  assert.equal(backup.budgets.length, 1);
  const receiver = await actor();
  const counts = await ledger.previewBackup(receiver, backup);
  assert.equal(counts.budgets, 1);
  assert.equal((await pool.query('SELECT id FROM personal_ledgers WHERE owner_user_id=$1', [receiver])).rows.length, 0);
  const invalid = structuredClone(backup); invalid.budgets[0]!.categoryLimits = [{ categoryId: 'missing', limitMinor: '10' }];
  await assert.rejects(() => ledger.restoreBackup(receiver, invalid), { code: 'budget_category_invalid' });
  const restored = await ledger.restoreBackup(receiver, backup);
  assert.equal(restored.budgets[0]?.ledgerId, restored.ledger.id); assert.equal(restored.budgets[0]?.createdByUserId, receiver);
  assert.deepEqual(restored.budgets[0]?.categoryLimits, backup.budgets[0]?.categoryLimits);
  assert.deepEqual(restored.transactions[0]?.originalAmount, backup.transactions[0]?.originalAmount);
  const legacy = { ...backup } as Record<string, unknown>; delete legacy.budgets;
  assert.deepEqual((await ledger.restoreBackup(await actor(), legacy)).budgets, []);
  const november = { ...plan, ...stamp(), month: '2026-11', categoryLimits: [], currency: 'EUR' };
  state = await ledger.execute(userId, { type: 'budget.save', budget: november, expectedRevision: 0 });
  const active = state.budgets.find(budget => budget.id === plan.id)!;
  state = await ledger.execute(userId, { type: 'budget.delete', id: active.id, expectedRevision: active.revision });
  assert.ok(state.budgets.find(budget => budget.id === plan.id)?.deletedAt);
  assert.equal(state.budgets.find(budget => budget.month === '2026-11')?.deletedAt, null);
  assert.deepEqual(state.transactions, backup.transactions);
  const recreated = { ...plan, ...stamp(), categoryLimits: [{ categoryId: beta.id, limitMinor: '1000' }] };
  state = await ledger.execute(userId, { type: 'budget.save', budget: recreated, expectedRevision: 0 });
  assert.equal(state.budgets.filter(budget => budget.month === '2026-10' && !budget.deletedAt).length, 1);
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...recreated, id: randomUUID(), deletedAt: stamp().createdAt }, expectedRevision: 0 }), { code: 'budget_month_exists' });
  // Deleted category limits remain readable and restorable, but cannot enter a new plan.
  const currentCategory = state.categories.find(category => category.id === beta.id)!;
  state = await ledger.execute(userId, { type: 'category.delete', id: beta.id, expectedRevision: currentCategory.revision });
  const activePlan = state.budgets.find(budget => budget.id === recreated.id)!;
  state = await ledger.execute(userId, { type: 'budget.save', budget: { ...activePlan, totalLimitMinor: '50000' }, expectedRevision: activePlan.revision });
  await assert.rejects(() => ledger.execute(userId, { type: 'budget.save', budget: { ...activePlan, ...stamp(), month: '2026-12' }, expectedRevision: 0 }), { code: 'budget_category_invalid' });
  const archivedCategoryBackup = await ledger.exportBackup(userId);
  assert.equal((await ledger.restoreBackup(await actor(), archivedCategoryBackup)).budgets.length, state.budgets.length);
});
