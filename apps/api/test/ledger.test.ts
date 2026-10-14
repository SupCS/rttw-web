import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase, Pool, QueryResult } from 'pg';
import type { Account, AuditFields, Category, RecurringRule, Transaction, TransactionSplit, TransferLink } from '@rttw/domain';
import { migrationOptions } from '../src/database/migrations.js';
import { LedgerService } from '../src/ledger/service.js';
import type { FxService } from '../src/fx/service.js';

function adapter(database: PGlite): Pool {
  const query = async (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
    const sql = typeof input === 'string' ? input : input.text;
    const parameters = values ?? (typeof input === 'string' ? undefined : input.values);
    const result = parameters?.length ? await database.query(sql, parameters) : (await database.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return { ...result, rowCount: result.affectedRows ?? result.rows.length } as unknown as QueryResult;
  };
  return { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
}

const audit = (): AuditFields => ({ id: randomUUID(), createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', createdByMemberId: 'untrusted-client', updatedByMemberId: 'untrusted-client', revision: 99, deletedAt: null });

test('PostgreSQL ledger authorizes scope and preserves exact financial records atomically', async (t) => {
  const db = new PGlite();
  const pool = adapter(db);
  t.after(() => db.close());
  await runner({ ...migrationOptions, dbClient: pool as unknown as ClientBase });
  const userId = randomUUID();
  const otherUserId = randomUUID();
  for (const [id, email] of [[userId, 'ledger@example.invalid'], [otherUserId, 'other-ledger@example.invalid']]) {
    await db.query('INSERT INTO users(id,email,password_hash) VALUES ($1,$2,\'test-hash\')', [id, email]);
  }
  const createHousehold = async (user: string) => {
    const householdId = randomUUID(); const memberId = randomUUID();
    await db.query('INSERT INTO households(id,name,base_currency_code,created_by_user_id,updated_by_user_id) VALUES ($1,\'Ledger household\',\'USD\',$2,$2)', [householdId, user]);
    await db.query('INSERT INTO household_members(id,household_id,user_id,display_name,role,membership_status,created_by_user_id,updated_by_user_id) VALUES ($1,$2,$3,\'Owner\',\'owner\',\'active\',$3,$3)', [memberId, householdId, user]);
    return { householdId, memberId };
  };
  const { householdId, memberId } = await createHousehold(userId);
  const other = await createHousehold(otherUserId);
  const ledger = new LedgerService(pool);
  const account = (name: string): Account => ({ ...audit(), householdId, ownershipScope: 'personal', ownerMemberId: memberId, name, accountType: 'cash', primaryCurrency: 'USD', openingBalances: [{ currency: 'USD', amountMinor: '9007199254740993' }, { currency: 'JPY', amountMinor: '123' }], isArchived: false });
  const category = (name: string): Category => ({ ...audit(), householdId, parentId: null, applicability: 'both', systemKey: null, names: { en: name, uk: name, ru: name }, icon: 'cart', colorToken: 'surface', iconColor: 'text', isArchived: false });
  const expense = (accountId: string, categoryId: string | null, amountMinor = '-500'): Transaction => ({ ...audit(), householdId, accountId, memberId, categoryId, transactionType: 'expense', transactionDate: '2026-10-10', postingDate: null, source: 'manual', status: 'confirmed', originalAmount: { currency: 'USD', amountMinor }, reportingAmount: { currency: 'USD', amountMinor }, fxSnapshot: null, description: 'Expense', notes: null });
  const split = (transaction: Transaction, categoryId: string, amountMinor: string): TransactionSplit => ({ ...audit(), householdId, transactionId: transaction.id, categoryId, amount: { currency: 'USD', amountMinor } });
  const first = account('First'); const second = account('Second'); const food = category('Food'); const travel = category('Travel');

  await t.test('membership applies to every read, write, export and restore', async () => {
    for (const action of [
      () => ledger.getSnapshot(otherUserId, householdId),
      () => ledger.execute(otherUserId, householdId, { type: 'account.save', account: first }),
      () => ledger.exportBackup(otherUserId, householdId),
    ]) await assert.rejects(action, { code: 'household_access_denied', statusCode: 403 });
    await db.query('UPDATE household_members SET membership_status=\'removed\' WHERE id=$1', [other.memberId]);
    await assert.rejects(() => ledger.getSnapshot(otherUserId, other.householdId), { code: 'household_access_denied' });
  });

  await t.test('multi-currency money stays exact and server controls audit fields', async () => {
    const initialized = await ledger.getSnapshot(userId, householdId);
    assert.equal(initialized.categories.length, 10);
    assert.equal(initialized.accounts.length, 0);
    assert.deepEqual(initialized.categories.find((item) => item.systemKey === 'groceries')?.names, { en: 'Groceries', uk: 'Продукти', ru: 'Продукты' });
    await ledger.execute(userId, householdId, { type: 'account.save', account: first });
    await ledger.execute(userId, householdId, { type: 'account.save', account: second });
    await ledger.execute(userId, householdId, { type: 'category.save', category: food });
    await ledger.execute(userId, householdId, { type: 'category.save', category: travel });
    const saved = (await ledger.getSnapshot(userId, householdId)).accounts.find((item) => item.id === first.id)!;
    assert.equal(saved.openingBalances[0]?.amountMinor, '9007199254740993');
    assert.equal(saved.revision, 1); assert.equal(saved.createdByMemberId, memberId); assert.notEqual(saved.createdAt, first.createdAt);
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'account.save', account: { ...first, householdId: other.householdId }, expectedRevision: 1 }), { code: 'cross_household_reference' });
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'account.save', account: { ...first, openingBalances: [{ currency: 'USD', amountMinor: 0.1 }] }, expectedRevision: 1 }), { code: 'invalid_ledger_command' });
  });

  const original = expense(first.id, food.id);
  const allocations = [split(original, food.id, '-300'), split(original, travel.id, '-200')];
  await t.test('split failures roll back and stale changes cannot overwrite history', async () => {
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'transaction.save', transaction: original, splits: [allocations[0]] }), { code: 'split_amount_mismatch' });
    assert.equal((await ledger.getSnapshot(userId, householdId)).transactions.length, 0);
    await ledger.execute(userId, householdId, { type: 'transaction.save', transaction: original, splits: allocations });
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'transaction.save', transaction: { ...original, description: 'stale' }, splits: allocations, expectedRevision: 0 }), { code: 'revision_conflict', statusCode: 409 });
    const bad = expense('wrong-household-account', food.id);
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'transaction.save', transaction: bad, splits: [] }), { code: 'account_not_found' });
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'account.save', account: { ...first, primaryCurrency: 'JPY', openingBalances: [{ currency: 'JPY', amountMinor: '1' }] }, expectedRevision: 1 }), { code: 'currency_has_transaction_history' });
    const current = (await ledger.getSnapshot(userId, householdId)).transactions[0]!;
    await ledger.execute(userId, householdId, { type: 'transaction.save', transaction: { ...current, description: 'Explicit edit' }, splits: [split(current, food.id, '-500')], expectedRevision: 1 });
    await ledger.execute(userId, householdId, { type: 'transaction.delete', id: original.id, expectedRevision: 2 });
    await ledger.execute(userId, householdId, { type: 'transaction.restore', id: original.id, expectedRevision: 3 });
    const restored = await ledger.getSnapshot(userId, householdId);
    assert.equal(restored.splits.filter((item) => item.transactionId === original.id && item.deletedAt === null).length, 1, 'restore does not resurrect superseded allocations');
    assert.equal(restored.transactions.find((item) => item.id === original.id)?.originalAmount.amountMinor, '-500');
  });

  const debit: Transaction = { ...expense(first.id, null, '-1000'), transactionType: 'transfer' };
  const credit: Transaction = { ...expense(second.id, null, '1000'), transactionType: 'transfer' };
  const fee = expense(first.id, food.id, '-30');
  const link: TransferLink = { ...audit(), householdId, debitTransactionId: debit.id, creditTransactionId: credit.id, feeTransactionId: fee.id, sentAmount: { currency: 'USD', amountMinor: '1000' }, receivedAmount: { currency: 'USD', amountMinor: '1000' } };
  await t.test('linked transfers preserve principal, separate fees and delete/restore together', async () => {
    const before = (await ledger.getSnapshot(userId, householdId)).transactions.length;
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'transfer.create', debit, credit: { ...credit, originalAmount: { currency: 'USD', amountMinor: '999' } }, link, fee }), { code: 'transfer_amount_mismatch' });
    assert.equal((await ledger.getSnapshot(userId, householdId)).transactions.length, before);
    await ledger.execute(userId, householdId, { type: 'transfer.create', debit, credit, link, fee });
    let state = await ledger.getSnapshot(userId, householdId);
    assert.equal(state.transferLinks.length, 1);
    assert.equal(state.transactions.filter((item) => item.transactionType === 'transfer').reduce((sum, item) => sum + BigInt(item.originalAmount.amountMinor), 0n), 0n);
    await ledger.execute(userId, householdId, { type: 'transaction.delete', id: debit.id, expectedRevision: 1 });
    state = await ledger.getSnapshot(userId, householdId);
    for (const id of [debit.id, credit.id, fee.id]) assert.ok(state.transactions.find((item) => item.id === id)?.deletedAt);
    await ledger.execute(userId, householdId, { type: 'transaction.restore', id: credit.id, expectedRevision: 2 });
    state = await ledger.getSnapshot(userId, householdId);
    for (const id of [debit.id, credit.id, fee.id]) assert.equal(state.transactions.find((item) => item.id === id)?.deletedAt, null);
  });

  const template = expense(first.id, food.id, '-100');
  const recurring: RecurringRule = { ...audit(), householdId, templateTransactionId: template.id, frequency: 'daily', interval: 1, startsOn: '2026-10-10', endsOn: '2026-10-12', isActive: true };
  await t.test('recurring catch-up is atomic and idempotent with cloned splits', async () => {
    await ledger.execute(userId, householdId, { type: 'transaction.save', transaction: template, splits: [split(template, food.id, '-100')] });
    await ledger.execute(userId, householdId, { type: 'recurring.save', rule: recurring });
    const once = await ledger.getSnapshot(userId, householdId, '2026-10-12');
    const twice = await ledger.getSnapshot(userId, householdId, '2026-10-12');
    assert.equal(twice.transactions.length, once.transactions.length);
    assert.equal(twice.transactions.filter((item) => item.source === 'recurring').length, 2);
    assert.equal(twice.splits.filter((item) => twice.transactions.some((transaction) => transaction.source === 'recurring' && transaction.id === item.transactionId)).length, 2);
    assert.equal((await db.query('SELECT * FROM web_recurring_occurrences WHERE household_id=$1', [householdId])).rows.length, 3);
  });

  await t.test('pending FX retries without changing originals and recurring dates use new snapshots', async () => {
    const foreignAccount = { ...account('Euro account'), primaryCurrency: 'EUR' as const, openingBalances: [{ currency: 'EUR' as const, amountMinor: '0' }] };
    await ledger.execute(userId, householdId, { type: 'account.save', account: foreignAccount });
    let available = false;
    const requestedDates: string[] = [];
    const fx = {
      forDatabase(database: unknown) { assert.ok(database); return this; },
      async rates(base: string, quotes: string[], date: string) {
        requestedDates.push(date);
        if (!available) throw new Error('provider unavailable');
        return { rates: [{ base, quote: quotes[0], rateDecimal: date.endsWith('11') ? '1.3' : date.endsWith('12') ? '1.4' : '1.2', requestedDate: date, effectiveDate: date, provider: 'frankfurter' }] };
      },
    } as unknown as FxService;
    const retrying = new LedgerService(pool, fx);
    const foreign: Transaction = { ...expense(foreignAccount.id, food.id, '-100'), originalAmount: { currency: 'EUR', amountMinor: '-100' }, reportingAmount: null, status: 'fx_pending', postingDate: '2026-10-09' };
    await retrying.execute(userId, householdId, { type: 'transaction.save', transaction: foreign, splits: [] });
    let state = await retrying.getSnapshot(userId, householdId, '2026-10-10');
    assert.equal(state.transactions.find((item) => item.id === foreign.id)?.status, 'fx_pending');
    available = true;
    state = await retrying.getSnapshot(userId, householdId, '2026-10-10');
    const completed = state.transactions.find((item) => item.id === foreign.id)!;
    assert.equal(completed.originalAmount.amountMinor, '-100');
    assert.equal(completed.reportingAmount?.amountMinor, '-120');
    assert.equal(completed.fxSnapshot?.requestedDate, '2026-10-09');
    assert.equal(completed.status, 'confirmed');
    assert.ok(requestedDates.includes('2026-10-09'));
    await assert.rejects(() => retrying.execute(userId, householdId, { type: 'transaction.save', transaction: { ...completed, reportingAmount: { currency: 'USD', amountMinor: '-140' }, fxSnapshot: { ...completed.fxSnapshot!, rateDecimal: '1.4' } }, splits: [], expectedRevision: completed.revision }), { code: 'fx_snapshot_immutable' });
    const rule: RecurringRule = { ...recurring, ...audit(), templateTransactionId: foreign.id };
    await retrying.execute(userId, householdId, { type: 'recurring.save', rule });
    state = await retrying.getSnapshot(userId, householdId, '2026-10-12');
    state = await retrying.getSnapshot(userId, householdId, '2026-10-12');
    const clones = state.transactions.filter((item) => item.accountId === foreignAccount.id && item.source === 'recurring');
    assert.deepEqual(clones.map((item) => item.reportingAmount?.amountMinor).sort(), ['-130', '-140']);
    assert.deepEqual(clones.map((item) => item.fxSnapshot?.requestedDate).sort(), ['2026-10-11', '2026-10-12']);
    const receiving = { ...foreignAccount, ...audit(), name: 'Second euro account' };
    await ledger.execute(userId, householdId, { type: 'account.save', account: receiving });
    let attempts = 0;
    const partialFx = {
      forDatabase() { return this; },
      async rates(base: string, quotes: string[], date: string) {
        if (++attempts === 1) throw new Error('temporary provider failure');
        return { rates: [{ base, quote: quotes[0], rateDecimal: '1.2', requestedDate: date, effectiveDate: date, provider: 'frankfurter' }] };
      },
    } as unknown as FxService;
    const partialLedger = new LedgerService(pool, partialFx);
    const left: Transaction = { ...foreign, ...audit(), transactionType: 'transfer', categoryId: null, postingDate: null };
    const right: Transaction = { ...left, ...audit(), accountId: receiving.id, originalAmount: { currency: 'EUR', amountMinor: '100' } };
    const euroLink: TransferLink = { ...link, ...audit(), debitTransactionId: left.id, creditTransactionId: right.id, feeTransactionId: null, sentAmount: { currency: 'EUR', amountMinor: '100' }, receivedAmount: { currency: 'EUR', amountMinor: '100' } };
    const initial = await partialLedger.execute(userId, householdId, { type: 'transfer.create', debit: left, credit: right, link: euroLink });
    assert.equal(attempts, 0, 'financial writes do not wait for an FX provider');
    assert.equal(initial.transactions.find((item) => item.id === left.id)?.status, 'fx_pending');
    assert.equal(initial.transactions.find((item) => item.id === right.id)?.status, 'fx_pending');
    await partialLedger.getSnapshot(userId, householdId, '2026-10-12');
    assert.equal(attempts, 1, 'a failing provider consumes the one-row snapshot budget');
    const partial = await partialLedger.getSnapshot(userId, householdId, '2026-10-12');
    assert.equal(attempts, 2);
    assert.deepEqual([left.id, right.id].map((id) => partial.transactions.find((item) => item.id === id)?.status).sort(), ['confirmed', 'fx_pending']);
    const target = await createHousehold(userId);
    await partialLedger.previewBackup(userId, target.householdId, await partialLedger.exportBackup(userId, householdId));
  });

  await t.test('durable command receipts prevent duplicate copies and reject reused payload keys', async () => {
    const originalRecord = (await ledger.getSnapshot(userId, householdId, '2026-10-12')).transactions.find((item) => item.id === original.id)!;
    const requestId = randomUUID();
    const command = { type: 'transaction.copy', id: original.id, expectedRevision: originalRecord.revision };
    const before = (await ledger.getSnapshot(userId, householdId, '2026-10-12')).transactions.length;
    const firstCopy = await ledger.execute(userId, householdId, command, requestId);
    const duplicateCopy = await ledger.execute(userId, householdId, command, requestId);
    assert.equal(firstCopy.transactions.length, before + 1);
    assert.equal(duplicateCopy.transactions.length, before + 1);
    assert.equal((await db.query('SELECT * FROM web_operation_receipts WHERE household_id=$1 AND request_id=$2', [householdId, requestId])).rows.length, 1);
    await assert.rejects(() => ledger.execute(userId, householdId, { ...command, type: 'transaction.delete' }, requestId), { code: 'request_id_conflict', statusCode: 409 });
    assert.equal((await ledger.getSnapshot(userId, householdId, '2026-10-12')).transactions.find((item) => item.id === original.id)?.deletedAt, null);
    const failedId = randomUUID();
    const invalid = expense(first.id, food.id, '500');
    await assert.rejects(() => ledger.execute(userId, householdId, { type: 'transaction.save', transaction: invalid, splits: [] }, failedId), { code: 'invalid_transaction_sign' });
    assert.equal((await db.query('SELECT * FROM web_operation_receipts WHERE household_id=$1 AND request_id=$2', [householdId, failedId])).rows.length, 0);
    const valid = { ...invalid, originalAmount: { currency: 'USD', amountMinor: '-500' }, reportingAmount: { currency: 'USD', amountMinor: '-500' } };
    await ledger.execute(userId, householdId, { type: 'transaction.save', transaction: valid, splits: [] }, failedId);
    assert.equal((await db.query('SELECT * FROM web_operation_receipts WHERE household_id=$1 AND request_id=$2', [householdId, failedId])).rows.length, 1, 'validation failure leaves the retry key available');
  });

  await t.test('FX lookup releases financial clients and cannot overwrite an intervening manual correction', async () => {
    const target = await createHousehold(userId);
    let activeClients = 0;
    let connections = 0;
    const countedPool = {
      query: pool.query.bind(pool),
      async connect() {
        const client = await pool.connect(); activeClients++; connections++;
        return { query: client.query.bind(client), release() { activeClients--; client.release(); } };
      },
    } as unknown as Pool;
    let started!: () => void;
    let finishLookup!: () => void;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const delayedFx = {
      async rates(base: string, quotes: string[], date: string) {
        calls++; started();
        await new Promise<void>((resolve) => { finishLookup = resolve; });
        return { rates: [{ base, quote: quotes[0], rateDecimal: '2', requestedDate: date, effectiveDate: date, provider: 'frankfurter' }] };
      },
    } as unknown as FxService;
    const racing = new LedgerService(countedPool, delayedFx);
    const targetAccount: Account = { ...account('Concurrent euro account'), householdId: target.householdId, ownerMemberId: target.memberId, primaryCurrency: 'EUR', openingBalances: [{ currency: 'EUR', amountMinor: '0' }] };
    await racing.execute(userId, target.householdId, { type: 'account.save', account: targetAccount });
    const pending: Transaction = { ...expense(targetAccount.id, null, '-100'), householdId: target.householdId, memberId: target.memberId, originalAmount: { currency: 'EUR', amountMinor: '-100' }, reportingAmount: null, status: 'fx_pending' };
    await racing.execute(userId, target.householdId, { type: 'transaction.save', transaction: pending, splits: [] });
    const lookup = racing.getSnapshot(userId, target.householdId, '2026-10-12');
    await providerStarted;
    assert.equal(activeClients, 0, 'provider waits hold no financial transaction or pool client');
    const manual: Transaction = { ...pending, description: 'Manual correction during provider wait', status: 'confirmed', reportingAmount: { currency: 'USD', amountMinor: '-150' }, fxSnapshot: { provider: 'manual', rateDecimal: '1.5', requestedDate: pending.transactionDate, effectiveDate: pending.transactionDate } };
    const written = await racing.execute(userId, target.householdId, { type: 'transaction.save', transaction: manual, splits: [], expectedRevision: 1 }, randomUUID());
    assert.equal(written.transactions[0]?.reportingAmount?.amountMinor, '-150');
    assert.equal(activeClients, 0);
    finishLookup();
    const result = await lookup;
    assert.equal(result.transactions[0]?.reportingAmount?.amountMinor, '-150', 'stale provider result cannot replace the manual snapshot');
    assert.equal(result.transactions[0]?.fxSnapshot?.provider, 'manual');
    assert.equal(result.transactions[0]?.description, manual.description);
    assert.equal(result.transactions[0]?.revision, 2);
    assert.equal(result.transactions[0]?.originalAmount.amountMinor, '-100');
    assert.equal(calls, 1);
    const withoutProvider = new LedgerService(countedPool);
    await withoutProvider.execute(userId, target.householdId, { type: 'transaction.save', transaction: { ...pending, ...audit() }, splits: [] });
    const before = connections;
    await withoutProvider.getSnapshot(userId, target.householdId, '2026-10-12');
    assert.equal(connections - before, 1, 'a provider-free snapshot needs only its pure household transaction');
    assert.equal(activeClients, 0);
  });

  await t.test('backups roundtrip into an empty authorized household with identity mapping', async () => {
    const backup = await ledger.exportBackup(userId, householdId);
    assert.equal('member' in backup, false); assert.equal('users' in backup, false);
    const destination = await createHousehold(userId);
    const preview = await ledger.previewBackup(userId, destination.householdId, backup);
    assert.equal(preview.accounts, backup.accounts.length);
    assert.equal((await db.query('SELECT * FROM web_ledger_entities WHERE household_id=$1', [destination.householdId])).rows.length, 0, 'preview does not seed or persist any rows');
    const mixed = structuredClone(backup); mixed.accounts[0]!.householdId = other.householdId;
    await assert.rejects(() => ledger.restoreBackup(userId, destination.householdId, mixed), { code: 'invalid_backup_household' });
    assert.equal((await ledger.getSnapshot(userId, destination.householdId)).accounts.length, 0);
    const restored = await ledger.restoreBackup(userId, destination.householdId, backup);
    assert.equal(restored.accounts.length, backup.accounts.length);
    assert.equal(restored.transactions.length, backup.transactions.length);
    assert.equal(restored.accounts[0]?.householdId, destination.householdId);
    assert.equal(restored.accounts[0]?.ownerMemberId, destination.memberId);
    assert.equal(restored.accounts.find((item) => item.id === first.id)?.openingBalances[0]?.amountMinor, '9007199254740993');
    const caughtUp = await ledger.getSnapshot(userId, destination.householdId, '2026-10-12');
    assert.equal(caughtUp.transactions.length, restored.transactions.length);
    await assert.rejects(() => ledger.restoreBackup(userId, destination.householdId, backup), { code: 'restore_requires_empty_ledger' });
    await assert.rejects(() => ledger.restoreBackup(otherUserId, destination.householdId, backup), { code: 'household_access_denied' });
    const editedDestination = await createHousehold(userId);
    const seeded = await ledger.getSnapshot(userId, editedDestination.householdId);
    const builtIn = seeded.categories[0]!;
    await ledger.execute(userId, editedDestination.householdId, { type: 'category.save', category: { ...builtIn, isArchived: true }, expectedRevision: builtIn.revision });
    await assert.rejects(() => ledger.previewBackup(userId, editedDestination.householdId, backup), { code: 'restore_requires_empty_ledger' });
    const sourceCategory = (await ledger.getSnapshot(userId, householdId)).categories.find((item) => item.id === builtIn.id)!;
    assert.equal(sourceCategory.isArchived, false, 'built-in category mutations remain household scoped');
  });
});
