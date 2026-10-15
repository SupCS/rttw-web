import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase } from 'pg';
import { addDays, type Account, type RecurringRule, type Transaction } from '@rttw/domain';
import { createLocalDatabasePool } from '../src/database/local.js';
import { migrationOptions } from '../src/database/migrations.js';
import { LedgerService } from '../src/ledger/service.js';

const stamp = () => ({ id: randomUUID(), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdByUserId: null, updatedByUserId: null, revision: 1, deletedAt: null });
async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const db = new PGlite(); const pool = createLocalDatabasePool(db); t.after(() => pool.end());
  await runner({ ...migrationOptions, dbClient: pool as unknown as ClientBase, log: () => {} });
  const userId = randomUUID(); await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [userId, `${userId}@example.invalid`, 'test']);
  const ledger = new LedgerService(pool);
  const newLedger = async (owner = randomUUID()) => {
    await db.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test') ON CONFLICT(id) DO NOTHING", [owner, `${owner}@example.invalid`]);
    const state = await ledger.getSnapshot(owner);
    return { id: state.ledger.id, userId: owner };
  };
  const home = await newLedger(userId);
  const account: Account = { ...stamp(), ledgerId: home.id, name: 'Test account', accountType: 'cash', primaryCurrency: 'USD', openingBalances: [{ currency: 'USD', amountMinor: '0' }, { currency: 'EUR', amountMinor: '0' }], isArchived: false };
  const state = await ledger.execute(userId, { type: 'account.save', account, expectedRevision: 0 });
  return { db, ledger, userId, home, newLedger, account: state.accounts[0]!, categories: state.categories, date: new Date().toISOString().slice(0, 10) };
}

test('independent payments: atomic recording, exact splits, future edits, pause/resume and restore', async (t) => {
  const { db, ledger, userId, home, newLedger, account, categories, date } = await fixture(t);
  const splits = [
    { categoryId: categories[0]!.id, amount: { currency: 'USD' as const, amountMinor: '-4503599627370496' } },
    { categoryId: categories[1]!.id, amount: { currency: 'USD' as const, amountMinor: '-4503599627370497' } },
  ];
  const rule: RecurringRule = { ...stamp(), ledgerId: home.id, templateTransactionId: null, frequency: 'daily', interval: 1,
    startsOn: addDays(date, -2), endsOn: addDays(date, 1), isActive: true,
    payment: { accountId: account.id, categoryId: null, transactionType: 'expense', originalAmount: { currency: 'USD', amountMinor: '-9007199254740993' }, description: 'Recurring test', notes: null, splits } };
  const requestId = randomUUID();
  const create = { type: 'recurring.save', rule, expectedRevision: 0, asOf: date };
  const created = await ledger.execute(userId, create, requestId);
  assert.equal(created.transactions.length, 3); assert.equal(created.splits.length, 6);
  assert.ok(created.transactions.every((item) => item.source === 'recurring' && item.originalAmount.amountMinor === '-9007199254740993'));
  assert.equal((await ledger.execute(userId, create, requestId)).transactions.length, 3);
  assert.equal((await ledger.getSnapshot(userId, date)).transactions.length, 3);
  const originals = structuredClone(created.transactions);
  const current = created.recurringRules[0]!;
  const changed = { ...current, frequency: 'weekly' as const, startsOn: addDays(date, 1), endsOn: null,
    payment: { ...current.payment!, originalAmount: { currency: 'USD' as const, amountMinor: '-20000' }, splits: splits.map((item) => ({ ...item, amount: { currency: 'USD' as const, amountMinor: '-10000' } })) } };
  await ledger.execute(userId, { type: 'recurring.save', rule: changed, expectedRevision: current.revision, asOf: date });
  const next = await ledger.getSnapshot(userId, addDays(date, 1));
  for (const original of originals) assert.deepEqual(next.transactions.find((item) => item.id === original.id), original);
  assert.equal(next.transactions.find((item) => item.transactionDate === addDays(date, 1))?.originalAmount.amountMinor, '-20000');
  const pauseExample: RecurringRule = { ...rule, ...stamp(), startsOn: addDays(date, -10), payment: { ...rule.payment!, description: 'Pause test' } };
  const old = (await ledger.execute(userId, { type: 'recurring.save', rule: pauseExample, expectedRevision: 0, asOf: pauseExample.startsOn })).recurringRules.find((item) => item.id === pauseExample.id)!;
  const paused = (await ledger.execute(userId, { type: 'recurring.save', rule: { ...old, isActive: false }, expectedRevision: old.revision, asOf: old.startsOn })).recurringRules.find((item) => item.id === old.id)!;
  await ledger.execute(userId, { type: 'recurring.save', rule: { ...paused, isActive: true }, expectedRevision: paused.revision, asOf: date });
  let resumed = await ledger.getSnapshot(userId, date);
  assert.equal(resumed.transactions.filter((item) => item.description === 'Pause test').length, 1);
  resumed = await ledger.getSnapshot(userId, addDays(date, 1));
  assert.equal(resumed.transactions.filter((item) => item.description === 'Pause test').length, 2);
  const foreign: RecurringRule = { ...rule, ...stamp(), startsOn: addDays(date, 1), endsOn: null, payment: { ...rule.payment!, categoryId: categories[0]!.id, originalAmount: { currency: 'EUR', amountMinor: '-10301' }, splits: [], description: 'Foreign test' } };
  await ledger.execute(userId, { type: 'recurring.save', rule: foreign, expectedRevision: 0, asOf: date });
  const posted = await ledger.getSnapshot(userId, addDays(date, 1));
  const foreignTransaction = posted.transactions.find((item) => item.description === 'Foreign test')!;
  assert.equal(foreignTransaction.status, 'fx_pending'); assert.equal(foreignTransaction.fxSnapshot, null);
  assert.deepEqual(foreignTransaction.originalAmount, foreign.payment!.originalAmount);
  const backup = await ledger.exportBackup(userId); const target = await newLedger();
  await ledger.previewBackup(target.userId, backup);
  const restored = await ledger.restoreBackup(target.userId, backup);
  assert.equal(restored.transactions.length, posted.transactions.length);
  assert.ok(restored.recurringRules.every((item) => item.ledgerId === target.id));
  for (const original of posted.transactions) {
    const copied = restored.transactions.find((item) => item.id === original.id)!;
    assert.deepEqual(copied.originalAmount, original.originalAmount); assert.equal(copied.transactionDate, original.transactionDate); assert.deepEqual(copied.fxSnapshot, original.fxSnapshot);
  }
  await assert.rejects(() => ledger.execute(randomUUID(), create), { code: 'ledger_access_denied' });
  const savedForeign = posted.recurringRules.find((item) => item.id === foreign.id)!;
  await ledger.execute(userId, { type: 'recurring.delete', id: foreign.id, expectedRevision: savedForeign.revision });
  assert.equal((await ledger.getSnapshot(userId, date)).transactions.length, posted.transactions.length);
  assert.equal((await db.query('SELECT * FROM ledger_recurring_occurrences WHERE ledger_id=$1', [home.id])).rows.length, posted.transactions.length);
});

test('template history preserves applied FX and avoids duplicating the first payment', async (t) => {
  const { db, ledger, userId, home, account, categories, date } = await fixture(t);
  const original: Transaction = { ...stamp(), ledgerId: home.id, accountId: account.id, categoryId: categories[1]!.id,
    transactionType: 'expense', transactionDate: addDays(date, -2), postingDate: null, source: 'manual', status: 'confirmed',
    originalAmount: { currency: 'EUR', amountMinor: '-10301' }, reportingAmount: { currency: 'USD', amountMinor: '-12361' },
    fxSnapshot: { rateDecimal: '1.2', provider: 'manual', requestedDate: addDays(date, -2), effectiveDate: addDays(date, -2) }, description: 'Legacy test', notes: null };
  const split = { ...stamp(), ledgerId: home.id, transactionId: original.id, categoryId: categories[0]!.id, amount: original.originalAmount };
  const saved = (await ledger.execute(userId, { type: 'transaction.save', transaction: original, splits: [split], expectedRevision: 0 })).transactions[0]!;
  const rule: RecurringRule = { ...stamp(), ledgerId: home.id, templateTransactionId: original.id, payment: { accountId: account.id, categoryId: split.categoryId, transactionType: 'expense', originalAmount: original.originalAmount, description: original.description, notes: original.notes, splits: [] }, frequency: 'daily', interval: 1, startsOn: original.transactionDate, endsOn: addDays(date, 1), isActive: true };
  await db.query("INSERT INTO ledger_entities(ledger_id,entity_kind,id,revision,entity) VALUES($1,'recurring',$2,1,$3::jsonb)", [home.id, rule.id, JSON.stringify(rule)]);
  const state = await ledger.getSnapshot(userId, date);
  assert.equal(state.transactions.length, 3); assert.deepEqual(state.transactions.find((item) => item.id === original.id), saved);
  const migrated = state.recurringRules[0]!;
  assert.deepEqual(migrated.payment?.originalAmount, original.originalAmount);
  assert.equal(migrated.payment?.categoryId, split.categoryId); assert.deepEqual(migrated.payment?.splits, []);
  const replacement = { ...saved, originalAmount: { currency: 'EUR', amountMinor: '-20301' }, reportingAmount: { currency: 'USD', amountMinor: '-24361' } };
  await ledger.execute(userId, { type: 'transaction.save', transaction: replacement, splits: [{ ...split, amount: replacement.originalAmount }], expectedRevision: saved.revision });
  const future = await ledger.getSnapshot(userId, addDays(date, 1));
  const generated = future.transactions.find((item) => item.transactionDate === addDays(date, 1))!;
  assert.equal(generated.originalAmount.amountMinor, '-10301'); assert.equal(generated.fxSnapshot, null);
  assert.equal((await ledger.getSnapshot(userId, addDays(date, 1))).transactions.length, 4);
});
