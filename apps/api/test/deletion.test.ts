import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase } from 'pg';
import type { Account, AuditFields, LedgerCommand, LedgerSnapshot, Transaction, TransferLink } from '@rttw/domain';
import { createLocalDatabasePool } from '../src/database/local.js';
import { migrationOptions } from '../src/database/migrations.js';
import { LedgerService } from '../src/ledger/service.js';
import { accountBalances, balances, cashFlow } from '../../web/src/data/derived.js';

const date = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
const stamp = (): AuditFields => ({ id: randomUUID(), createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z`, createdByUserId: null, updatedByUserId: null, revision: 1, deletedAt: null });

test('account and category deletion preserve money, history and atomicity', async (t) => {
  const database = new PGlite();
  const pool = createLocalDatabasePool(database);
  t.after(() => pool.end());
  await runner({ ...migrationOptions, dbClient: pool as unknown as ClientBase });
  const userId = randomUUID();
  const outsider = randomUUID();
  for (const id of [userId, outsider]) await database.query('INSERT INTO users(id,email,password_hash) VALUES ($1,$2,\'test\')', [id, `${id}@example.invalid`]);
  const service = new LedgerService(pool);
  async function personalLedger() {
    const userId = randomUUID();
    await database.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test')", [userId, `${userId}@example.invalid`]);
    const state = await service.getSnapshot(userId);
    return { ledgerId: state.ledger.id, userId };
  }
  async function fixture() {
    const { ledgerId, userId } = await personalLedger();
    const source: Account = { ...stamp(), ledgerId, name: 'Source', accountType: 'debit_card', primaryCurrency: 'USD',
      openingBalances: [{ currency: 'USD', amountMinor: '9007199254740993' }, { currency: 'GEL', amountMinor: '-82426' }, { currency: 'EUR', amountMinor: '0' }], isArchived: false };
    const target: Account = { ...source, ...stamp(), name: 'Target', openingBalances: [{ currency: 'USD', amountMinor: '500' }] };
    let state = await service.execute(userId, { type: 'account.save', account: source });
    const run = async (command: LedgerCommand) => state = await service.execute(userId, command);
    await run({ type: 'account.save', account: target });
    const expense: Transaction = { ...stamp(), ledgerId, accountId: source.id, categoryId: state.categories.find((item) => item.applicability === 'expense')!.id, transactionType: 'expense', transactionDate: date,
      postingDate: null, status: 'confirmed', source: 'manual', originalAmount: { currency: 'USD', amountMinor: '-123' }, reportingAmount: { currency: 'USD', amountMinor: '-123' }, fxSnapshot: null, description: 'History', notes: 'Keep this' };
    await run({ type: 'transaction.save', transaction: expense, splits: [] });
    const foreign: Transaction = { ...expense, ...stamp(), originalAmount: { currency: 'EUR', amountMinor: '-100' }, reportingAmount: { currency: 'USD', amountMinor: '-110' },
      fxSnapshot: { provider: 'manual', rateDecimal: '1.1', requestedDate: date, effectiveDate: date } };
    await run({ type: 'transaction.save', transaction: foreign, splits: [] });
    const transfer = async (planned: boolean) => {
      const debit: Transaction = { ...expense, ...stamp(), categoryId: null, transactionType: 'transfer', transactionDate: planned ? tomorrow : date, status: planned ? 'planned' : 'confirmed', originalAmount: { currency: 'USD', amountMinor: '-50' }, reportingAmount: { currency: 'USD', amountMinor: '-50' } };
      const credit: Transaction = { ...debit, ...stamp(), accountId: target.id, originalAmount: { currency: 'USD', amountMinor: '50' }, reportingAmount: { currency: 'USD', amountMinor: '50' } };
      const link: TransferLink = { ...stamp(), ledgerId, debitTransactionId: debit.id, creditTransactionId: credit.id, feeTransactionId: null, sentAmount: { currency: 'USD', amountMinor: '50' }, receivedAmount: { currency: 'USD', amountMinor: '50' } };
      await run({ type: 'transfer.create', debit, credit, link });
      return { debit, credit, link };
    };
    const historyTransfer = await transfer(false);
    const plannedTransfer = await transfer(true);
    const future = { ...expense, ...stamp(), transactionDate: tomorrow, status: 'planned' as const };
    await run({ type: 'transaction.save', transaction: future, splits: [] });
    const rule = { ...stamp(), ledgerId, templateTransactionId: null, payment: { accountId: source.id, categoryId: null, transactionType: 'expense' as const, originalAmount: { currency: 'USD' as const, amountMinor: '-10' }, description: null, notes: null, splits: [] }, frequency: 'daily' as const, interval: 1, startsOn: tomorrow, endsOn: null, isActive: true };
    await run({ type: 'recurring.save', rule, asOf: date });
    const command = (destinationAccountId: string | null): LedgerCommand => ({ type: 'account.delete', id: source.id, expectedRevision: state.accounts.find((item) => item.id === source.id)!.revision,
      asOf: date, expectedBalances: accountBalances(state, state.accounts.find((item) => item.id === source.id)!, date), destinationAccountId });
    return { ledgerId, userId, source, target, expense, foreign, historyTransfer, plannedTransfer, future, rule, run, command, state: () => state };
  }

  await t.test('discard excludes balances without an expense, keeps exact history and cancels future entries', async () => {
    const f = await fixture();
    const before = f.state();
    const historical = before.transactions.filter((item) => item.transactionDate === date);
    const result = await f.run(f.command(null));
    assert.ok(result.accounts.find((item) => item.id === f.source.id)?.deletedAt);
    assert.deepEqual(balances(result, date), [{ currency: 'USD', amountMinor: '550' }]);
    assert.deepEqual(cashFlow(result, date, date), cashFlow(before, date, date));
    for (const tx of historical) assert.deepEqual(result.transactions.find((item) => item.id === tx.id), tx);
    for (const id of [f.future.id, f.plannedTransfer.debit.id, f.plannedTransfer.credit.id]) assert.ok(result.transactions.find((item) => item.id === id)?.deletedAt);
    assert.ok(result.transferLinks.find((item) => item.id === f.plannedTransfer.link.id)?.deletedAt);
    assert.ok(result.recurringRules.find((item) => item.id === f.rule.id)?.deletedAt);
    assert.equal(result.transactions.length, before.transactions.length);
    await assert.rejects(() => service.execute(f.userId, { type: 'transaction.delete', id: f.historyTransfer.credit.id, expectedRevision: 1 }), { code: 'account_deleted' });
    await assert.rejects(() => service.execute(f.userId, { type: 'account.save', account: f.source, expectedRevision: 2 }), { code: 'account_deleted' });
    const exported = await service.exportBackup(f.userId);
    const destination = await personalLedger();
    await service.previewBackup(destination.userId, exported);
    const restored = await service.restoreBackup(destination.userId, exported);
    assert.deepEqual(balances(restored, date), balances(result, date));
  });

  await t.test('transfer moves all positive and negative currencies exactly, adds currencies and is idempotent', async () => {
    const f = await fixture();
    const before = f.state(), requestId = randomUUID(), command = f.command(f.target.id);
    const result = await service.execute(f.userId, command, requestId);
    assert.deepEqual(balances(result, date), balances(before, date));
    assert.deepEqual(cashFlow(result, date, date), cashFlow(before, date, date));
    assert.ok(accountBalances(result, result.accounts.find((item) => item.id === f.source.id)!, date).every((value) => value.amountMinor === '0'));
    assert.equal(result.transferLinks.length, before.transferLinks.length + 3);
    assert.deepEqual(result.transactions.find((item) => item.id === f.foreign.id), before.transactions.find((item) => item.id === f.foreign.id));
    const retry = await service.execute(f.userId, command, requestId);
    assert.equal(retry.transactions.length, result.transactions.length);
    const destination = await personalLedger();
    await service.previewBackup(destination.userId, await service.exportBackup(f.userId));
  });

  await t.test('unauthorized, stale balances, revisions and foreign destinations cannot delete or move money', async () => {
    const f = await fixture();
    const oldCommand = f.command(null);
    await assert.rejects(() => service.execute(outsider, oldCommand), { code: 'account_not_found' });
    await assert.rejects(() => service.execute(f.userId, { ...oldCommand, expectedRevision: 99 }), { code: 'revision_conflict' });
    const other = await fixture();
    await assert.rejects(() => service.execute(f.userId, f.command(other.target.id)), { code: 'invalid_transfer' });
    await f.run({ type: 'transaction.save', transaction: { ...f.expense, ...stamp() }, splits: [] });
    await assert.rejects(() => service.execute(f.userId, oldCommand), { code: 'balance_changed' });
    assert.equal((await service.getSnapshot(f.userId, date)).accounts.find((item) => item.id === f.source.id)?.deletedAt, null);
  });

  await t.test('failure after a partial transfer rolls back destination currencies, transfers and deletion', async () => {
    const f = await fixture();
    await f.run({ type: 'account.save', expectedRevision: 1, account: { ...f.source, openingBalances: [{ currency: 'USD', amountMinor: '1000' }, { currency: 'GEL', amountMinor: '-9223372036854775808' }, { currency: 'EUR', amountMinor: '0' }] } });
    const before = f.state();
    await assert.rejects(() => service.execute(f.userId, f.command(f.target.id)), { code: 'invalid_amount' });
    const after = await service.getSnapshot(f.userId, date);
    assert.deepEqual(after.accounts, [...before.accounts].sort((a,b) => a.id.localeCompare(b.id)));
    assert.equal(after.transactions.length, before.transactions.length);
    assert.equal(after.transferLinks.length, before.transferLinks.length);
  });

  await t.test('category deletion preserves historical labels, keeps children and prevents reuse or re-seeding', async () => {
    const f = await fixture();
    const category = f.state().categories.find((item) => item.id === f.expense.categoryId)!;
    const child = { ...category, ...stamp(), parentId: category.id, systemKey: null, names: { en: 'Child', uk: 'Child', ru: 'Child' } };
    await f.run({ type: 'category.save', category: child });
    await f.run({ type: 'recurring.save', rule: { ...f.rule, ...stamp(), payment: { ...f.rule.payment, categoryId: category.id } }, asOf: date });
    const before = f.state();
    const outsiderResult = await service.execute(outsider, { type: 'category.delete', id: category.id, expectedRevision: 1 });
    assert.equal(outsiderResult.userId, outsider);
    assert.equal((await service.getSnapshot(f.userId, date)).categories.find(item => item.id === category.id)?.deletedAt, null, 'matching built-in IDs never affect another user');
    const result = await f.run({ type: 'category.delete', id: category.id, expectedRevision: category.revision });
    assert.ok(result.categories.find((item) => item.id === category.id)?.deletedAt);
    assert.equal(result.categories.find((item) => item.id === child.id)?.parentId, null);
    assert.deepEqual(result.transactions, before.transactions);
    assert.deepEqual(balances(result, date), balances(before, date));
    assert.ok(result.recurringRules.filter((rule) => rule.payment?.categoryId === category.id).every((rule) => rule.deletedAt));
    await assert.rejects(() => service.execute(f.userId, { type: 'transaction.save', transaction: { ...f.expense, ...stamp() }, splits: [] }), { code: 'category_not_found' });
    assert.ok((await service.getSnapshot(f.userId, date)).categories.find((item) => item.id === category.id)?.deletedAt);
    const destination = await personalLedger();
    await service.previewBackup(destination.userId, await service.exportBackup(f.userId));
  });
});
