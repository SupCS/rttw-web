import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { convertMoney, money, occurrencesThrough, recurringTemplate, getRecurringPayment } from '@rttw/domain';
import type { Account, AuditFields, Category, MonthlyBudget, PersonalLedger, LedgerSnapshot, RecurringRule, Transaction, TransactionSplit, TransferLink } from '@rttw/domain';
import type { FxService } from '../fx/service.js';
import { backupSchema, budgetSchema, commandSchema, dateSchema, moneySchema, type LedgerBackup, type ParsedCommand } from './schemas.js';
import { defaultCategories } from './defaults.js';

export class LedgerError extends Error {
  constructor(readonly code: string, readonly statusCode = 400) { super(code); }
}

type Kind = 'account' | 'category' | 'transaction' | 'split' | 'transfer' | 'recurring' | 'budget';
type Entity = Account | Category | Transaction | TransactionSplit | TransferLink | RecurringRule | MonthlyBudget;
type IdentityRow = {
  id: string; owner_user_id: string; base_currency_code: PersonalLedger['baseCurrency']; created_at: Date; updated_at: Date;
  created_by_user_id: string; updated_by_user_id: string; revision: string | number; deleted_at: Date | null;
};
type Context = { db: PoolClient; ledgerId: string; userId: string; ledger: PersonalLedger; state: LedgerSnapshot; now: string };
const kinds: ReadonlyArray<[Kind, keyof Pick<LedgerSnapshot, 'accounts' | 'categories' | 'transactions' | 'splits' | 'transferLinks' | 'recurringRules' | 'budgets'>]> = [
  ['account', 'accounts'], ['category', 'categories'], ['transaction', 'transactions'], ['split', 'splits'], ['transfer', 'transferLinks'], ['recurring', 'recurringRules'], ['budget', 'budgets'],
];
function fail(code: string, status = 400): never { throw new LedgerError(code, status); }
const iso = (value: Date | string) => new Date(value).toISOString();
const same = isDeepStrictEqual;
const compatiblePostingStatus = (a: Transaction['status'], b: Transaction['status']) => a === b || ['confirmed', 'fx_pending'].includes(a) && ['confirmed', 'fx_pending'].includes(b);

/** Every operation locks the authenticated user's personal ledger before reading financial rows. */
export class LedgerService {
  private readonly fxAttemptTimes = new Map<string, number>();
  constructor(private readonly pool: Pool, private readonly fx?: FxService) {}

  async getSnapshot(userId: string, throughDate = new Date().toISOString().slice(0, 10)): Promise<LedgerSnapshot> {
    if (!dateSchema.safeParse(throughDate).success) fail('invalid_date');
    // A browser may already be on tomorrow's civil date relative to UTC.
    if (throughDate > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) fail('future_materialization_date');
    const { state, candidate } = await this.withLedger(userId, async (ctx) => {
      await this.catchUp(ctx, throughDate);
      let candidate = this.nextPendingFx(ctx.state);
      if (candidate?.originalAmount.currency === ctx.ledger.baseCurrency) {
        this.recordFxAttempt(ctx.ledgerId, candidate.id);
        await this.persist(ctx, 'transaction', this.audit(ctx, { ...candidate, reportingAmount: candidate.originalAmount, status: 'confirmed' }, candidate));
        candidate = undefined;
      }
      return { state: ctx.state, candidate };
    });
    if (!candidate || !this.fx) return state;
    this.recordFxAttempt(state.ledger.id, candidate.id);
    // No financial client or ledger lock is held while an upstream provider
    // responds. The second transaction authorizes and compares current state again.
    const resolved = await this.resolvePendingFx(candidate, state.ledger.baseCurrency);
    if (!resolved) return state;
    return this.withLedger(userId, async (ctx) => {
      const ledgerId = ctx.ledgerId;
      const current = ctx.state.transactions.find((transaction) => transaction.id === candidate.id);
      if (!current || current.deletedAt !== null || current.status !== 'fx_pending' || current.reportingAmount !== null || current.fxSnapshot !== null ||
        current.revision !== candidate.revision || !same(current.originalAmount, candidate.originalAmount) || current.transactionDate !== candidate.transactionDate ||
        current.postingDate !== candidate.postingDate || ctx.ledger.baseCurrency !== state.ledger.baseCurrency) return ctx.state;
      const next: Transaction = { ...current, ...resolved, status: 'confirmed' };
      this.transaction(ctx, next, ctx.state.splits.filter((split) => split.transactionId === current.id && split.deletedAt === null), current);
      await this.persist(ctx, 'transaction', this.audit(ctx, next, current));
      return ctx.state;
    });
  }

  async execute(userId: string, command: unknown, requestId?: string): Promise<LedgerSnapshot> {
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) fail('invalid_ledger_command');
    if (requestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) fail('invalid_request_id');
    const hash = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    return this.withLedger(userId, async (ctx) => {
      const ledgerId = ctx.ledgerId;
      if (requestId) {
        const receipt = await ctx.db.query<{ payload_sha256: string }>(
          'SELECT payload_sha256 FROM ledger_operation_receipts WHERE ledger_id=$1 AND request_id=$2',
          [ledgerId, requestId],
        );
        if (receipt.rows[0]) {
          if (receipt.rows[0].payload_sha256 !== hash) fail('request_id_conflict', 409);
          return ctx.state;
        }
      }
      await this.apply(ctx, parsed.data);
      if (requestId) await ctx.db.query(
        'INSERT INTO ledger_operation_receipts(ledger_id,request_id,payload_sha256) VALUES($1,$2,$3)',
        [ledgerId, requestId, hash],
      );
      return ctx.state;
    });
  }

  async exportBackup(userId: string): Promise<LedgerBackup> {
    return this.withLedger(userId, async (ctx) => {
      const ledgerId = ctx.ledgerId;
      const dates = await ctx.db.query<{ rule_id: string; occurrence_date: string; transaction_id: string }>(
        'SELECT rule_id, occurrence_date::text, transaction_id FROM ledger_recurring_occurrences WHERE ledger_id = $1 ORDER BY rule_id, occurrence_date', [ledgerId],
      );
      const { ledger, accounts, categories, transactions, splits, transferLinks, recurringRules, budgets } = ctx.state;
      // Identity/audit references are mapped on restore; user records are never exported.
      return { format: 'rttw-web-ledger', version: 2, exportedAt: ctx.now, ledger, accounts, categories, transactions, splits, transferLinks, recurringRules, budgets,
        recurringOccurrences: dates.rows.map((row) => ({ ruleId: row.rule_id, occurrenceDate: row.occurrence_date, transactionId: row.transaction_id })) };
    });
  }

  async previewBackup(userId: string, value: unknown) {
    return this.restoreBackup(userId, value, true).then((snapshot) => ({
      accounts: snapshot.accounts.length, categories: snapshot.categories.length, transactions: snapshot.transactions.length,
      splits: snapshot.splits.length, transferLinks: snapshot.transferLinks.length, recurringRules: snapshot.recurringRules.length, budgets: snapshot.budgets.length,
      baseCurrency: snapshot.ledger.baseCurrency,
    }));
  }

  async restoreBackup(userId: string, value: unknown, dryRun = false): Promise<LedgerSnapshot> {
    const parsed = backupSchema.safeParse(value);
    if (!parsed.success) fail('invalid_backup');
    return this.withLedger(userId, async (ctx) => {
      const ledgerId = ctx.ledgerId;
      if (kinds.some(([kind, key]) => kind === 'category' ? ctx.state.categories.some((category) => !this.pristineDefault(category)) : ctx.state[key].length)) fail('restore_requires_empty_ledger', 409);
      const backup = parsed.data;
      ctx.ledger = { ...ctx.ledger, baseCurrency: backup.ledger.baseCurrency };
      ctx.state = { ...ctx.state, ledger: ctx.ledger };
      const sourcePersonalLedger = backup.ledger.id;
      // First verify source scope before remapping. No mixed-ledger file is accepted.
      for (const [, key] of kinds) {
        const values = backup[key];
        if (new Set(values.map((entity) => entity.id)).size !== values.length) fail('duplicate_backup_id');
        for (const entity of values) if (entity.ledgerId !== sourcePersonalLedger) fail('invalid_backup_ledger');
      }
      const mapped = <T extends Entity>(entity: T): T => ({ ...entity, ledgerId, createdAt: ctx.now, updatedAt: ctx.now, revision: 1, createdByUserId: ctx.userId, updatedByUserId: ctx.userId });
      ctx.state = { ...ctx.state, accounts: backup.accounts.map(mapped), categories: backup.categories.map(mapped),
        transactions: backup.transactions.map(mapped), splits: backup.splits.map(mapped), transferLinks: backup.transferLinks.map(mapped), recurringRules: backup.recurringRules.map(mapped), budgets: backup.budgets.map(mapped) };
      this.validateWholeLedger(ctx);
      const occurrenceKeys = new Set<string>();
      const occurrenceTransactions = new Set<string>();
      for (const occurrence of backup.recurringOccurrences) {
        const rule = ctx.state.recurringRules.find((item) => item.id === occurrence.ruleId);
        const transaction = ctx.state.transactions.find((item) => item.id === occurrence.transactionId);
        const key = `${occurrence.ruleId}/${occurrence.occurrenceDate}`;
        if (!rule || !transaction || transaction.transactionDate !== occurrence.occurrenceDate || occurrenceKeys.has(key) || occurrenceTransactions.has(transaction.id)) fail('invalid_backup_occurrence');
        if (transaction.id !== rule.templateTransactionId && transaction.source !== 'recurring') fail('invalid_backup_occurrence');
        // Recorded dates can belong to an older schedule revision. Their saved
        // transaction, identity and date above are the historical source of truth.
        occurrenceKeys.add(key);
        occurrenceTransactions.add(transaction.id);
      }
      if (dryRun) return ctx.state;
      await ctx.db.query("DELETE FROM ledger_entities WHERE ledger_id = $1 AND entity_kind = 'category'", [ledgerId]);
      await ctx.db.query('UPDATE personal_ledgers SET base_currency_code=$1, updated_by_user_id=$2, updated_at=$3, revision=revision+1 WHERE id=$4', [backup.ledger.baseCurrency, userId, ctx.now, ledgerId]);
      ctx.ledger = { ...ctx.ledger, updatedAt: ctx.now, updatedByUserId: ctx.userId, revision: ctx.ledger.revision + 1 };
      ctx.state = { ...ctx.state, ledger: ctx.ledger };
      for (const [kind, key] of kinds) for (const entity of ctx.state[key]) await this.persist(ctx, kind, entity);
      for (const occurrence of backup.recurringOccurrences) await ctx.db.query(
        'INSERT INTO ledger_recurring_occurrences(ledger_id, rule_id, occurrence_date, transaction_id) VALUES ($1, $2, $3, $4)',
        [ledgerId, occurrence.ruleId, occurrence.occurrenceDate, occurrence.transactionId],
      );
      return ctx.state;
    }, !dryRun, !dryRun);
  }

  async settings(userId: string, baseCurrency: PersonalLedger['baseCurrency']): Promise<LedgerSnapshot> {
    return this.withLedger(userId, async (ctx) => {
      await ctx.db.query('UPDATE personal_ledgers SET base_currency_code=$1, updated_at=$2, updated_by_user_id=$3, revision=revision+1 WHERE id=$4', [baseCurrency, ctx.now, userId, ctx.ledgerId]);
      ctx.state = { ...ctx.state, ledger: { ...ctx.ledger, baseCurrency, updatedAt: ctx.now, updatedByUserId: userId, revision: ctx.ledger.revision + 1 } };
      return ctx.state;
    });
  }

  private async withLedger<T>(userId: string, action: (ctx: Context) => Promise<T>, seedDefaults = true, commit = true): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`INSERT INTO personal_ledgers (id, owner_user_id, base_currency_code, created_by_user_id, updated_by_user_id)
        SELECT $1, id, 'USD', id, id FROM users WHERE id=$2 AND deleted_at IS NULL
        ON CONFLICT (owner_user_id) DO NOTHING`, [randomUUID(), userId]);
      const identity = await db.query<IdentityRow>(`SELECT l.* FROM personal_ledgers l JOIN users u ON u.id=l.owner_user_id
        WHERE l.owner_user_id=$1 AND l.deleted_at IS NULL AND u.deleted_at IS NULL FOR UPDATE OF l`, [userId]);
      const row = identity.rows[0];
      if (!row) fail('ledger_access_denied', 403);
      const ledgerId = row.id;
      const ledger: PersonalLedger = { id: ledgerId, baseCurrency: row.base_currency_code,
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), createdByUserId: row.created_by_user_id,
        updatedByUserId: row.updated_by_user_id, revision: Number(row.revision), deletedAt: null };
      const state: LedgerSnapshot = { ledger, userId, accounts: [], categories: [], transactions: [], splits: [], transferLinks: [], recurringRules: [], budgets: [] };
      const entities = await db.query<{ entity_kind: Kind; entity: Entity }>('SELECT entity_kind, entity FROM ledger_entities WHERE ledger_id=$1 ORDER BY id', [ledgerId]);
      for (const result of entities.rows) {
        const key = kinds.find(([kind]) => kind === result.entity_kind)?.[1];
        if (key) (state[key] as Entity[]).push(result.entity);
      }
      const ctx = { db, ledgerId, ledger, userId, state, now: new Date().toISOString() };
      if (seedDefaults && !state.categories.length) for (const category of defaultCategories) await this.persist(ctx, 'category', {
        ...category, ledgerId, createdAt: ctx.now, updatedAt: ctx.now, createdByUserId: userId, updatedByUserId: userId, revision: 1, deletedAt: null,
      });
      const result = await action(ctx);
      await db.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally { db.release(); }
  }

  private audit<T extends Entity>(ctx: Context, incoming: T, previous?: T): T {
    return { ...incoming, ledgerId: ctx.ledgerId, createdAt: previous?.createdAt ?? ctx.now,
      createdByUserId: previous?.createdByUserId ?? ctx.userId, updatedAt: ctx.now, updatedByUserId: ctx.userId,
      revision: (previous?.revision ?? 0) + 1, deletedAt: previous?.deletedAt ?? null };
  }

  private expected(previous: Entity | undefined, revision: number | null | undefined) {
    if (previous ? revision !== previous.revision : revision !== undefined && revision !== null && revision !== 0) fail('revision_conflict', 409);
  }

  private async persist(ctx: Context, kind: Kind, entity: Entity) {
    await ctx.db.query(
      `INSERT INTO ledger_entities(ledger_id, entity_kind, id, revision, entity) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT(ledger_id, entity_kind, id) DO UPDATE SET revision = excluded.revision, entity = excluded.entity`,
      [ctx.ledgerId, kind, entity.id, entity.revision, JSON.stringify(entity)],
    );
    const key = kinds.find(([item]) => item === kind)![1];
    const list = ctx.state[key] as Entity[];
    const index = list.findIndex((item) => item.id === entity.id);
    if (index < 0) list.push(entity); else list[index] = entity;
  }

  private scope(ctx: Context, entity: { ledgerId: string | null }) {
    if (entity.ledgerId !== ctx.ledgerId) fail('cross_ledger_reference', 403);
  }

  private pristineDefault(category: Category) {
    const preset = defaultCategories.find((item) => item.id === category.id);
    return category.revision === 1 && category.deletedAt === null && preset !== undefined &&
      Object.entries(preset).every(([key, value]) => same(category[key as keyof Category], value));
  }

  private account(ctx: Context, value: Account) {
    this.scope(ctx, value);
    if (new Set(value.openingBalances.map((balance) => balance.currency)).size !== value.openingBalances.length || !value.openingBalances.some((balance) => balance.currency === value.primaryCurrency)) fail('invalid_account_currencies');
    if (ctx.state.transactions.some((transaction) => transaction.accountId === value.id && !value.openingBalances.some((balance) => balance.currency === transaction.originalAmount.currency))) fail('currency_has_transaction_history');
    if (ctx.state.recurringRules.some((rule) => !rule.deletedAt && rule.payment?.accountId === value.id && !value.openingBalances.some((balance) => balance.currency === rule.payment!.originalAmount.currency))) fail('currency_has_recurring_payments');
  }

  private category(ctx: Context, value: Category) {
    this.scope(ctx, value);
    if (value.applicability === 'income' && ctx.state.budgets.some(budget => !budget.deletedAt && budget.categoryLimits.some(limit => limit.categoryId === value.id))) fail('category_has_budget');
    const seen = new Set([value.id]);
    let parentId = value.parentId;
    while (parentId) {
      if (seen.has(parentId)) fail('category_parent_cycle');
      seen.add(parentId);
      const parent = ctx.state.categories.find((item) => item.id === parentId && (item.deletedAt === null || value.deletedAt !== null));
      if (!parent) fail('category_parent_not_found');
      if (parent.applicability !== 'both' && parent.applicability !== value.applicability) fail('category_applicability_mismatch');
      parentId = parent.parentId;
    }
    if (ctx.state.categories.some((child) => child.parentId === value.id && value.applicability !== 'both' && child.applicability !== value.applicability)) fail('category_applicability_mismatch');
    for (const transaction of ctx.state.transactions) {
      if (transaction.categoryId !== value.id && !ctx.state.splits.some((split) => split.transactionId === transaction.id && split.categoryId === value.id)) continue;
      const desired = transaction.transactionType === 'income' || transaction.transactionType === 'refund' ? 'income' : 'expense';
      if (value.applicability !== 'both' && value.applicability !== desired) fail('category_has_incompatible_history');
    }
    for (const rule of ctx.state.recurringRules) {
      const payment = rule.payment;
      if (!payment || rule.deletedAt || payment.categoryId !== value.id && !payment.splits.some((split) => split.categoryId === value.id)) continue;
      if (value.applicability !== 'both' && value.applicability !== payment.transactionType) fail('category_has_incompatible_history');
    }
  }

  private categoryForTransaction(ctx: Context, id: string, value: Transaction, allowExisting = false) {
    const category = ctx.state.categories.find((item) => item.id === id && (item.deletedAt === null || allowExisting));
    if (!category) fail('category_not_found');
    const desired = value.transactionType === 'income' || value.transactionType === 'refund' ? 'income' : 'expense';
    if (category.applicability !== 'both' && category.applicability !== desired) fail('category_applicability_mismatch');
  }

  private transaction(ctx: Context, value: Transaction, splits: TransactionSplit[], previous?: Transaction, existingCategories = false, historical = false) {
    this.scope(ctx, value);
    const account = ctx.state.accounts.find((item) => item.id === value.accountId && (item.deletedAt === null || historical));
    if (!account) fail('account_not_found');
    if (!account.openingBalances.some((balance) => balance.currency === value.originalAmount.currency)) fail('account_currency_not_found');
    const amount = BigInt(value.originalAmount.amountMinor);
    if (value.transactionType === 'expense' && amount >= 0n || value.transactionType === 'income' && amount <= 0n) fail('invalid_transaction_sign');
    if (value.categoryId) this.categoryForTransaction(ctx, value.categoryId, value, existingCategories || previous?.categoryId === value.categoryId);
    const reportingCurrency = value.reportingAmount?.currency ?? ctx.ledger.baseCurrency;
    if (!previous && value.reportingAmount && reportingCurrency !== ctx.ledger.baseCurrency) fail('invalid_reporting_currency');
    if (value.fxSnapshot && (!value.reportingAmount || value.originalAmount.currency === reportingCurrency)) fail('invalid_fx_snapshot');
    if (value.fxSnapshot) {
      if (value.fxSnapshot.requestedDate !== (value.postingDate ?? value.transactionDate) || value.fxSnapshot.effectiveDate > value.fxSnapshot.requestedDate) fail('invalid_fx_snapshot_date');
      const converted = convertMoney(money(amount, value.originalAmount.currency), reportingCurrency, value.fxSnapshot.rateDecimal);
      if (value.reportingAmount?.amountMinor !== converted.amountMinor.toString()) fail('invalid_reporting_amount');
    }
    if (value.status === 'confirmed' && value.originalAmount.currency !== reportingCurrency && !value.fxSnapshot) fail('confirmed_transaction_needs_fx_snapshot');
    if (value.status === 'confirmed' && !value.reportingAmount) fail('confirmed_transaction_needs_reporting_amount');
    if (value.originalAmount.currency === reportingCurrency && value.reportingAmount && !same(value.originalAmount, value.reportingAmount)) fail('invalid_reporting_amount');
    if (previous?.fxSnapshot && same(previous.originalAmount, value.originalAmount) && previous.transactionDate === value.transactionDate && (!same(previous.fxSnapshot, value.fxSnapshot) || !same(previous.reportingAmount, value.reportingAmount))) fail('fx_snapshot_immutable');
    if (new Set(splits.map((item) => item.id)).size !== splits.length) fail('duplicate_split_id');
    let total = 0n;
    for (const split of splits) {
      this.scope(ctx, split);
      if (split.transactionId !== value.id || split.amount.currency !== value.originalAmount.currency) fail('invalid_split_reference');
      const oldSplit = ctx.state.splits.find((item) => item.id === split.id && item.transactionId === value.id);
      this.categoryForTransaction(ctx, split.categoryId, value, existingCategories || oldSplit?.categoryId === split.categoryId);
      const splitAmount = BigInt(split.amount.amountMinor);
      if (amount < 0n ? splitAmount >= 0n : splitAmount <= 0n) fail('invalid_split_sign');
      if (split.deletedAt === null || value.deletedAt !== null && split.deletedAt === value.deletedAt) total += splitAmount;
    }
    if (splits.length && total !== amount) fail('split_amount_mismatch');
  }

  private transfer(ctx: Context, debit: Transaction, credit: Transaction, link: TransferLink, fee?: Transaction, restoring = false) {
    this.scope(ctx, link);
    const ids = [debit.id, credit.id, ...(fee ? [fee.id] : [])];
    if (new Set(ids).size !== ids.length || debit.accountId === credit.accountId || debit.transactionType !== 'transfer' || credit.transactionType !== 'transfer') fail('invalid_transfer');
    if (link.debitTransactionId !== debit.id || link.creditTransactionId !== credit.id || link.feeTransactionId !== (fee?.id ?? null)) fail('invalid_transfer_link');
    const amount = BigInt(link.sentAmount.amountMinor);
    if (amount <= 0n || !same(link.sentAmount, link.receivedAmount) || debit.originalAmount.currency !== link.sentAmount.currency || credit.originalAmount.currency !== link.sentAmount.currency || BigInt(debit.originalAmount.amountMinor) !== -amount || BigInt(credit.originalAmount.amountMinor) !== amount) fail('transfer_amount_mismatch');
    if (debit.transactionDate !== credit.transactionDate || !compatiblePostingStatus(debit.status, credit.status) || debit.categoryId || credit.categoryId) fail('invalid_transfer');
    if ([debit, credit, ...(fee ? [fee] : [])].some((transaction) => (transaction.deletedAt === null) !== (link.deletedAt === null))) fail('invalid_transfer_delete_state');
    this.transaction(ctx, debit, [], restoring ? debit : undefined, false, restoring);
    this.transaction(ctx, credit, [], restoring ? credit : undefined, false, restoring);
    if (fee) {
      if (fee.transactionType !== 'expense' || fee.accountId !== debit.accountId || fee.originalAmount.currency !== debit.originalAmount.currency || fee.transactionDate !== debit.transactionDate || !compatiblePostingStatus(fee.status, debit.status)) fail('invalid_transfer_fee');
      this.transaction(ctx, fee, [], restoring ? fee : undefined, false, restoring);
    }
  }

  private recurring(ctx: Context, rule: RecurringRule, previous?: RecurringRule) {
    this.scope(ctx, rule);
    const paymentAccount = getRecurringPayment(rule, ctx.state.transactions, ctx.state.splits)?.accountId;
    if (!ctx.state.accounts.some((account) => account.id === paymentAccount && !account.deletedAt)) fail('account_deleted', 409);
    if (rule.endsOn && rule.endsOn < rule.startsOn) fail('invalid_recurring_dates');
    if (!rule.payment) {
      const template = ctx.state.transactions.find((transaction) => transaction.id === rule.templateTransactionId && (transaction.deletedAt === null || !rule.isActive));
      if (!template || !['expense', 'income'].includes(template.transactionType)) fail('invalid_recurring_template');
    } else {
      const payment = rule.payment;
      const template = recurringTemplate(rule, [])!;
      const old = previous ? recurringTemplate(previous, ctx.state.transactions) : undefined;
      const oldPayment = previous ? getRecurringPayment(previous, ctx.state.transactions, ctx.state.splits) : null;
      const splits = payment.splits.map((split, index) => ({ ...template, id: `${rule.id}:split:${index}`, transactionId: template.id, categoryId: split.categoryId, amount: split.amount }));
      if (payment.splits.length && (payment.splits.length < 2 || payment.categoryId !== null || new Set(payment.splits.map((split) => split.categoryId)).size !== payment.splits.length)) fail('invalid_split');
      if (payment.categoryId) this.categoryForTransaction(ctx, payment.categoryId, template, oldPayment?.categoryId === payment.categoryId);
      for (const split of payment.splits) this.categoryForTransaction(ctx, split.categoryId, template, Boolean(oldPayment?.splits.some((item) => item.categoryId === split.categoryId)));
      this.transaction(ctx, template, splits, old ? { ...old, fxSnapshot: null, reportingAmount: null } : undefined, true);
    }
    if (rule.templateTransactionId && ctx.state.recurringRules.some((other) => other.id !== rule.id && other.templateTransactionId === rule.templateTransactionId && other.deletedAt === null)) fail('recurring_rule_exists', 409);
  }

  private budget(ctx: Context, value: MonthlyBudget, previous?: MonthlyBudget, restoring = false) {
    this.scope(ctx, value);
    if (!budgetSchema.safeParse(value).success) fail('invalid_budget');
    if (previous && previous.month !== value.month) fail('budget_month_locked', 409);
    if (!value.deletedAt && ctx.state.budgets.some(other => other.id !== value.id && !other.deletedAt && other.month === value.month)) fail('budget_month_exists', 409);
    for (const limit of value.categoryLimits) {
      const category = ctx.state.categories.find(item => item.id === limit.categoryId);
      if (!category || !value.deletedAt && category.applicability === 'income') fail('budget_category_invalid');
      if (category.deletedAt && !restoring && !previous?.categoryLimits.some(item => item.categoryId === category.id)) fail('budget_category_invalid');
    }
  }

  private validateWholeLedger(ctx: Context) {
    for (const budget of ctx.state.budgets) this.budget(ctx, budget, undefined, true);
    for (const account of ctx.state.accounts) this.account(ctx, account);
    for (const category of ctx.state.categories) this.category(ctx, category);
    for (const transaction of ctx.state.transactions) this.transaction(ctx, transaction, ctx.state.splits.filter((split) => split.transactionId === transaction.id && (split.deletedAt === null || transaction.deletedAt !== null && split.deletedAt === transaction.deletedAt)), transaction, false, true);
    for (const split of ctx.state.splits) if (!ctx.state.transactions.some((transaction) => transaction.id === split.transactionId)) fail('invalid_split_reference');
    const linked = new Set<string>();
    for (const link of ctx.state.transferLinks) {
      const debit = ctx.state.transactions.find((transaction) => transaction.id === link.debitTransactionId);
      const credit = ctx.state.transactions.find((transaction) => transaction.id === link.creditTransactionId);
      const fee = link.feeTransactionId ? ctx.state.transactions.find((transaction) => transaction.id === link.feeTransactionId) : undefined;
      if (!debit || !credit || link.feeTransactionId && !fee) fail('invalid_transfer_link');
      this.transfer(ctx, debit, credit, link, fee, true);
      for (const id of [debit.id, credit.id, ...(fee ? [fee.id] : [])]) {
        if (linked.has(id)) fail('duplicate_transfer_link');
        linked.add(id);
      }
    }
    if (ctx.state.transactions.some((transaction) => transaction.transactionType === 'transfer' && !linked.has(transaction.id))) fail('unlinked_transfer');
    for (const rule of ctx.state.recurringRules) if (rule.deletedAt === null) this.recurring(ctx, rule, rule);
  }

  private async apply(ctx: Context, command: ParsedCommand) {
    switch (command.type) {
      case 'budget.save': {
        const previous = ctx.state.budgets.find(item => item.id === command.budget.id);
        if (previous?.deletedAt) fail('budget_deleted', 409);
        this.expected(previous, command.expectedRevision);
        this.scope(ctx, command.budget);
        const budget = this.audit(ctx, command.budget, previous);
        this.budget(ctx, budget, previous);
        await this.persist(ctx, 'budget', budget); return;
      }
      case 'budget.delete': {
        const previous = ctx.state.budgets.find(item => item.id === command.id && !item.deletedAt);
        if (!previous) fail('budget_not_found', 404);
        this.expected(previous, command.expectedRevision);
        await this.persist(ctx, 'budget', { ...this.audit(ctx, previous, previous), deletedAt: ctx.now }); return;
      }
      case 'account.save': {
        const previous = ctx.state.accounts.find((item) => item.id === command.account.id);
        if (previous?.deletedAt) fail('account_deleted', 409);
        this.expected(previous, command.expectedRevision); this.account(ctx, command.account);
        await this.persist(ctx, 'account', this.audit(ctx, { ...command.account, isArchived: false }, previous)); return;
      }
      case 'account.delete': return this.deleteAccount(ctx, command);
      case 'category.delete': {
        const category = ctx.state.categories.find((item) => item.id === command.id && !item.deletedAt);
        if (!category) fail('category_not_found', 404);
        this.expected(category, command.expectedRevision);
        // Keep labels and historical allocations; only future selection is removed.
        for (const child of [...ctx.state.categories]) if (child.parentId === category.id && !child.deletedAt) {
          await this.persist(ctx, 'category', this.audit(ctx, { ...child, parentId: category.parentId }, child));
        }
        for (const rule of [...ctx.state.recurringRules]) {
          const payment = getRecurringPayment(rule, ctx.state.transactions, ctx.state.splits);
          if (!rule.deletedAt && payment && (payment.categoryId === category.id || payment.splits.some((split) => split.categoryId === category.id))) {
            await this.persist(ctx, 'recurring', { ...this.audit(ctx, rule, rule), isActive: false, deletedAt: ctx.now });
          }
        }
        await this.persist(ctx, 'category', { ...this.audit(ctx, category, category), isArchived: false, deletedAt: ctx.now }); return;
      }
      case 'category.save': {
        const previous = ctx.state.categories.find((item) => item.id === command.category.id);
        if (previous?.deletedAt) fail('category_deleted', 409);
        if (command.category.systemKey !== (previous?.systemKey ?? null)) fail('system_category_key_immutable');
        this.expected(previous, command.expectedRevision); this.category(ctx, command.category);
        await this.persist(ctx, 'category', this.audit(ctx, { ...command.category, isArchived: false }, previous)); return;
      }
      case 'transaction.save': {
        const previous = ctx.state.transactions.find((item) => item.id === command.transaction.id);
        this.expected(previous, command.expectedRevision);
        if (previous?.deletedAt) fail('transaction_deleted', 409);
        if (previous && ctx.state.accounts.some((account) => account.id === previous.accountId && account.deletedAt)) fail('account_deleted', 409);
        if (command.transaction.transactionType === 'transfer' || ctx.state.transferLinks.some((link) => [link.debitTransactionId, link.creditTransactionId, link.feeTransactionId].includes(command.transaction.id))) fail('linked_transfer_edit_not_allowed');
        this.transaction(ctx, command.transaction, command.splits, previous);
        for (const split of command.splits) if (ctx.state.splits.some((item) => item.id === split.id && item.transactionId !== command.transaction.id)) fail('split_id_in_use', 409);
        await this.persist(ctx, 'transaction', this.audit(ctx, command.transaction, previous));
        const oldSplits = ctx.state.splits.filter((split) => split.transactionId === command.transaction.id);
        for (const old of oldSplits) if (!command.splits.some((split) => split.id === old.id)) await this.persist(ctx, 'split', { ...this.audit(ctx, old, old), deletedAt: ctx.now });
        for (const split of command.splits) await this.persist(ctx, 'split', { ...this.audit(ctx, split, oldSplits.find((old) => old.id === split.id)), deletedAt: null });
        return;
      }
      case 'transfer.create': {
        if (ctx.state.transferLinks.some((item) => item.id === command.link.id) || [command.debit, command.credit, ...(command.fee ? [command.fee] : [])].some((transaction) => ctx.state.transactions.some((item) => item.id === transaction.id))) fail('transfer_id_in_use', 409);
        this.transfer(ctx, command.debit, command.credit, command.link, command.fee);
        await this.persist(ctx, 'transaction', this.audit(ctx, command.debit));
        await this.persist(ctx, 'transaction', this.audit(ctx, command.credit));
        if (command.fee) await this.persist(ctx, 'transaction', this.audit(ctx, command.fee));
        await this.persist(ctx, 'transfer', this.audit(ctx, command.link)); return;
      }
      case 'recurring.save': {
        const previous = ctx.state.recurringRules.find((item) => item.id === command.rule.id);
        this.expected(previous, command.expectedRevision); this.recurring(ctx, command.rule, previous);
        if (previous?.deletedAt) fail('recurring_deleted', 409);
        const asOf = command.asOf ?? ctx.now.slice(0, 10);
        if (asOf > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) fail('future_materialization_date');
        const changed = previous && (!same(previous.payment, command.rule.payment) || previous.frequency !== command.rule.frequency || previous.interval !== command.rule.interval || previous.startsOn !== command.rule.startsOn || previous.endsOn !== command.rule.endsOn);
        if (previous?.isActive && (changed || !command.rule.isActive)) await this.catchUp(ctx, asOf, previous.id);
        const skipThrough = previous && (changed || !previous.isActive && command.rule.isActive) ? [previous.skipThrough ?? '', asOf].sort().at(-1)! : previous?.skipThrough ?? null;
        const next = this.audit(ctx, { ...command.rule, skipThrough }, previous);
        await this.persist(ctx, 'recurring', next);
        await this.catchUp(ctx, asOf, next.id); return;
      }
      case 'recurring.delete': {
        const previous = ctx.state.recurringRules.find((item) => item.id === command.id);
        if (!previous) fail('recurring_not_found', 404);
        this.expected(previous, command.expectedRevision);
        await this.persist(ctx, 'recurring', { ...this.audit(ctx, previous, previous), isActive: false, deletedAt: ctx.now }); return;
      }
      case 'transaction.delete': case 'transaction.restore': {
        const previous = ctx.state.transactions.find((item) => item.id === command.id);
        if (!previous) fail('transaction_not_found', 404);
        this.expected(previous, command.expectedRevision);
        const deletedAt = command.type === 'transaction.delete' ? ctx.now : null;
        if ((previous.deletedAt !== null) === (deletedAt !== null)) return;
        const links = ctx.state.transferLinks.filter((link) => [link.debitTransactionId, link.creditTransactionId, link.feeTransactionId].includes(command.id));
        const ids = new Set([command.id, ...links.flatMap((link) => [link.debitTransactionId, link.creditTransactionId, ...(link.feeTransactionId ? [link.feeTransactionId] : [])])]);
        if (ctx.state.transactions.some((transaction) => ids.has(transaction.id) && ctx.state.accounts.some((account) => account.id === transaction.accountId && account.deletedAt))) fail('account_deleted', 409);
        for (const transaction of [...ctx.state.transactions]) if (ids.has(transaction.id)) await this.persist(ctx, 'transaction', { ...this.audit(ctx, transaction, transaction), deletedAt });
        for (const split of [...ctx.state.splits]) if (ids.has(split.transactionId) && (deletedAt ? split.deletedAt === null : split.deletedAt === previous.deletedAt)) await this.persist(ctx, 'split', { ...this.audit(ctx, split, split), deletedAt });
        for (const link of links) await this.persist(ctx, 'transfer', { ...this.audit(ctx, link, link), deletedAt });
        for (const rule of [...ctx.state.recurringRules]) {
          if (rule.payment || !rule.templateTransactionId || !ids.has(rule.templateTransactionId)) continue;
          if (deletedAt && rule.deletedAt === null && rule.isActive) await this.persist(ctx, 'recurring', { ...this.audit(ctx, rule, rule), isActive: false, deletedAt });
          if (!deletedAt && rule.deletedAt === previous.deletedAt) await this.persist(ctx, 'recurring', { ...this.audit(ctx, rule, rule), isActive: true, deletedAt: null });
        }
        return;
      }
      case 'transaction.copy': {
        const previous = ctx.state.transactions.find((item) => item.id === command.id && item.deletedAt === null);
        if (!previous) fail('transaction_not_found', 404);
        this.expected(previous, command.expectedRevision);
        if (previous.transactionType === 'transfer' || ctx.state.transferLinks.some((link) => link.feeTransactionId === previous.id)) fail('linked_transfer_copy_not_allowed');
        const copy = this.audit(ctx, { ...previous, id: randomUUID(), source: 'manual' as const, deletedAt: null });
        const splits = ctx.state.splits.filter((split) => split.transactionId === previous.id && split.deletedAt === null).map((split) => this.audit(ctx, { ...split, id: randomUUID(), transactionId: copy.id }));
        this.transaction(ctx, copy, splits, copy);
        await this.persist(ctx, 'transaction', copy);
        for (const split of splits) await this.persist(ctx, 'split', split);
        return;
      }
      case 'category.merge': {
        const source = ctx.state.categories.find((item) => item.id === command.sourceCategoryId && item.deletedAt === null);
        const target = ctx.state.categories.find((item) => item.id === command.targetCategoryId && item.deletedAt === null);
        if (!source || !target || source.id === target.id) fail('invalid_category_merge');
        this.expected(source, command.expectedRevision);
        if (target.applicability !== 'both' && target.applicability !== source.applicability) fail('category_applicability_mismatch');
        let parent = target;
        while (parent.parentId) {
          if (parent.parentId === source.id) fail('category_parent_cycle');
          const ancestor = ctx.state.categories.find((item) => item.id === parent.parentId);
          if (!ancestor) break; parent = ancestor;
        }
        for (const category of [...ctx.state.categories]) if (category.parentId === source.id) await this.persist(ctx, 'category', this.audit(ctx, { ...category, parentId: target.id }, category));
        for (const transaction of [...ctx.state.transactions]) if (transaction.categoryId === source.id) await this.persist(ctx, 'transaction', this.audit(ctx, { ...transaction, categoryId: target.id }, transaction));
        for (const split of [...ctx.state.splits]) if (split.categoryId === source.id) await this.persist(ctx, 'split', this.audit(ctx, { ...split, categoryId: target.id }, split));
        for (const rule of [...ctx.state.recurringRules]) {
          const payment = rule.payment;
          if (!payment || payment.categoryId !== source.id && !payment.splits.some((split) => split.categoryId === source.id)) continue;
          const combined = new Map<string, bigint>();
          for (const split of payment.splits) { const id = split.categoryId === source.id ? target.id : split.categoryId; combined.set(id, (combined.get(id) ?? 0n) + BigInt(split.amount.amountMinor)); }
          const splits = [...combined].map(([categoryId, amount]) => ({ categoryId, amount: { currency: payment.originalAmount.currency, amountMinor: amount.toString() } }));
          const categoryId = splits.length === 1 ? splits[0]!.categoryId : payment.categoryId === source.id ? target.id : payment.categoryId;
          await this.persist(ctx, 'recurring', this.audit(ctx, { ...rule, payment: { ...payment, categoryId, splits: splits.length === 1 ? [] : splits } }, rule));
        }
        for (const budget of [...ctx.state.budgets]) {
          if (budget.deletedAt || !budget.categoryLimits.some(limit => limit.categoryId === source.id)) continue;
          const limits = new Map<string, bigint>();
          for (const limit of budget.categoryLimits) {
            const categoryId = limit.categoryId === source.id ? target.id : limit.categoryId;
            const amount = (limits.get(categoryId) ?? 0n) + BigInt(limit.limitMinor);
            if (amount > 9223372036854775807n) fail('budget_limit_overflow');
            limits.set(categoryId, amount);
          }
          const next = { ...budget, categoryLimits: [...limits].map(([categoryId, amount]) => ({ categoryId, limitMinor: amount.toString() })) };
          this.budget(ctx, next, budget);
          await this.persist(ctx, 'budget', this.audit(ctx, next, budget));
        }
        await this.persist(ctx, 'category', { ...this.audit(ctx, source, source), isArchived: false, deletedAt: ctx.now }); return;
      }
    }
  }

  private async deleteAccount(ctx: Context, command: Extract<ParsedCommand, { type: 'account.delete' }>) {
    const source = ctx.state.accounts.find((account) => account.id === command.id && !account.deletedAt);
    if (!source) fail('account_not_found', 404);
    this.expected(source, command.expectedRevision);
    const serverDay = Date.parse(ctx.now.slice(0, 10));
    if (Math.abs(Date.parse(command.asOf) - serverDay) > 86400000) fail('invalid_date');
    const rules = ctx.state.recurringRules.filter((rule) => !rule.deletedAt && recurringTemplate(rule, ctx.state.transactions)?.accountId === source.id);
    for (const rule of rules) await this.catchUp(ctx, command.asOf, rule.id);
    const balances = new Map(source.openingBalances.map((value) => [value.currency, BigInt(value.amountMinor)]));
    for (const transaction of ctx.state.transactions) {
      if (transaction.accountId !== source.id || transaction.deletedAt || transaction.transactionDate > command.asOf || !['confirmed', 'fx_pending'].includes(transaction.status)) continue;
      const { currency, amountMinor } = transaction.originalAmount;
      balances.set(currency, (balances.get(currency) ?? 0n) + BigInt(amountMinor));
    }
    if (command.expectedBalances.length !== balances.size || new Set(command.expectedBalances.map((value) => value.currency)).size !== balances.size ||
      command.expectedBalances.some((value) => balances.get(value.currency) !== BigInt(value.amountMinor))) fail('balance_changed', 409);
    let target = command.destinationAccountId === null ? null : ctx.state.accounts.find((account) => account.id === command.destinationAccountId && !account.deletedAt && account.id !== source.id);
    if (command.destinationAccountId !== null && !target) fail('invalid_transfer');
    if (target) {
      const missing = [...balances].filter(([currency, amount]) => amount !== 0n && !target!.openingBalances.some((value) => value.currency === currency));
      if (missing.length) {
        target = this.audit(ctx, { ...target, openingBalances: [...target.openingBalances, ...missing.map(([currency]) => ({ currency, amountMinor: '0' }))] }, target);
        this.account(ctx, target);
        await this.persist(ctx, 'account', target);
      }
      for (const [currency, amount] of balances) {
        if (amount === 0n) continue;
        const absolute = amount < 0n ? -amount : amount;
        if (!moneySchema.safeParse({ currency, amountMinor: absolute.toString() }).success) fail('invalid_amount');
        const makeTransaction = (accountId: string, amountMinor: bigint): Transaction => {
          const originalAmount = { currency, amountMinor: amountMinor.toString() };
          return { id: randomUUID(), createdAt: ctx.now, updatedAt: ctx.now, createdByUserId: ctx.userId, updatedByUserId: ctx.userId, revision: 1, deletedAt: null,
            ledgerId: ctx.ledgerId, accountId, categoryId: null, transactionType: 'transfer', transactionDate: command.asOf,
            postingDate: null, source: 'manual', status: currency === ctx.ledger.baseCurrency ? 'confirmed' : 'fx_pending', originalAmount,
            reportingAmount: currency === ctx.ledger.baseCurrency ? originalAmount : null, fxSnapshot: null, description: null, notes: null };
        };
        // A negative balance moves the liability: debit the destination, credit the closing account.
        const debit = makeTransaction(amount > 0n ? source.id : target.id, -absolute);
        const credit = makeTransaction(amount > 0n ? target.id : source.id, absolute);
        const link: TransferLink = { id: randomUUID(), createdAt: ctx.now, updatedAt: ctx.now, createdByUserId: ctx.userId, updatedByUserId: ctx.userId,
          revision: 1, deletedAt: null, ledgerId: ctx.ledgerId, debitTransactionId: debit.id, creditTransactionId: credit.id, feeTransactionId: null,
          sentAmount: { currency, amountMinor: absolute.toString() }, receivedAmount: { currency, amountMinor: absolute.toString() } };
        this.transfer(ctx, debit, credit, link);
        await this.persist(ctx, 'transaction', debit);
        await this.persist(ctx, 'transaction', credit);
        await this.persist(ctx, 'transfer', link);
      }
    }
    // Cancel future/unposted entries, including both sides of any planned transfer.
    const cancelled = new Set(ctx.state.transactions.filter((transaction) => transaction.accountId === source.id && !transaction.deletedAt &&
      (transaction.transactionDate > command.asOf || !['confirmed', 'fx_pending'].includes(transaction.status))).map((transaction) => transaction.id));
    for (const link of [...ctx.state.transferLinks]) if (!link.deletedAt && [link.debitTransactionId, link.creditTransactionId, link.feeTransactionId].some((id) => id && cancelled.has(id))) {
      for (const id of [link.debitTransactionId, link.creditTransactionId, link.feeTransactionId]) if (id) cancelled.add(id);
      await this.persist(ctx, 'transfer', { ...this.audit(ctx, link, link), deletedAt: ctx.now });
    }
    for (const transaction of [...ctx.state.transactions]) if (cancelled.has(transaction.id)) await this.persist(ctx, 'transaction', { ...this.audit(ctx, transaction, transaction), deletedAt: ctx.now });
    for (const split of [...ctx.state.splits]) if (!split.deletedAt && cancelled.has(split.transactionId)) await this.persist(ctx, 'split', { ...this.audit(ctx, split, split), deletedAt: ctx.now });
    for (const rule of rules) await this.persist(ctx, 'recurring', { ...this.audit(ctx, rule, rule), isActive: false, deletedAt: ctx.now });
    await this.persist(ctx, 'account', { ...this.audit(ctx, source, source), isArchived: false, deletedAt: ctx.now });
  }

  private async catchUp(ctx: Context, throughDate: string, ruleId?: string) {
    const existing = await ctx.db.query<{ rule_id: string; occurrence_date: string }>('SELECT rule_id, occurrence_date::text FROM ledger_recurring_occurrences WHERE ledger_id = $1', [ctx.ledgerId]);
    const dates = new Set(existing.rows.map((row) => `${row.rule_id}/${row.occurrence_date}`));
    for (const rule of [...ctx.state.recurringRules]) {
      if (!rule.isActive || rule.deletedAt || ruleId && rule.id !== ruleId) continue;
      const template = recurringTemplate(rule, ctx.state.transactions);
      if (!template) continue;
      if (ctx.state.accounts.some((account) => account.id === template.accountId && account.deletedAt)) continue;
      const scheduled = occurrencesThrough(rule, throughDate, 10001);
      if (scheduled.length > 10000) fail('recurring_catchup_limit');
      const legacy = rule.payment && rule.templateTransactionId ? ctx.state.transactions.find((item) => item.id === rule.templateTransactionId) : undefined;
      if (legacy && !legacy.deletedAt && ['confirmed', 'fx_pending'].includes(legacy.status) && scheduled.includes(legacy.transactionDate) && !dates.has(`${rule.id}/${legacy.transactionDate}`)) {
        await ctx.db.query('INSERT INTO ledger_recurring_occurrences(ledger_id, rule_id, occurrence_date, transaction_id) VALUES ($1, $2, $3, $4)', [ctx.ledgerId, rule.id, legacy.transactionDate, legacy.id]);
        dates.add(`${rule.id}/${legacy.transactionDate}`);
      }
      const templateSplits: TransactionSplit[] = rule.payment
        ? rule.payment.splits.map((split) => this.audit(ctx, { id: randomUUID(), ledgerId: ctx.ledgerId, createdAt: ctx.now, updatedAt: ctx.now,
          createdByUserId: ctx.userId, updatedByUserId: ctx.userId, revision: 1, deletedAt: null, transactionId: template.id, categoryId: split.categoryId, amount: split.amount }))
        : ctx.state.splits.filter((split) => split.transactionId === template.id && split.deletedAt === null);
      for (const occurrenceDate of scheduled) {
        const key = `${rule.id}/${occurrenceDate}`;
        if (dates.has(key)) continue;
        const usesTemplate = !rule.payment && occurrenceDate === template.transactionDate;
        const reusableReporting = template.originalAmount.currency === ctx.ledger.baseCurrency ? template.originalAmount : null;
        const transaction = usesTemplate
          ? (template.status === 'planned' ? this.audit(ctx, { ...template, status: template.reportingAmount ? 'confirmed' as const : 'fx_pending' as const }, template) : template)
          : this.audit(ctx, { ...template, id: randomUUID(), transactionDate: occurrenceDate, postingDate: null, source: 'recurring' as const,
            status: reusableReporting ? 'confirmed' as const : 'fx_pending' as const, reportingAmount: reusableReporting, fxSnapshot: null, deletedAt: null });
        const splits = usesTemplate ? templateSplits : templateSplits.map((split) => this.audit(ctx, { ...split, id: randomUUID(), transactionId: transaction.id }));
        this.transaction(ctx, transaction, splits, usesTemplate ? template : undefined, true);
        await this.persist(ctx, 'transaction', transaction);
        if (!usesTemplate) for (const split of splits) await this.persist(ctx, 'split', split);
        await ctx.db.query('INSERT INTO ledger_recurring_occurrences(ledger_id, rule_id, occurrence_date, transaction_id) VALUES ($1, $2, $3, $4)', [ctx.ledgerId, rule.id, occurrenceDate, transaction.id]);
        dates.add(key);
      }
    }
  }

  private nextPendingFx(state: LedgerSnapshot) {
    const attemptKey = (transaction: Transaction) => `${state.ledger.id}/${transaction.id}`;
    return state.transactions.filter((transaction) => transaction.deletedAt === null && transaction.status === 'fx_pending' && transaction.reportingAmount === null && transaction.fxSnapshot === null && state.accounts.some((account) => account.id === transaction.accountId && !account.deletedAt))
      .sort((a, b) => (this.fxAttemptTimes.get(attemptKey(a)) ?? 0) - (this.fxAttemptTimes.get(attemptKey(b)) ?? 0))
      .at(0);
  }

  private recordFxAttempt(ledgerId: string, transactionId: string) {
    // Disposable scheduling metadata prevents one unavailable currency/date from
    // starving other rows. Financial state stays entirely in PostgreSQL.
    this.fxAttemptTimes.set(`${ledgerId}/${transactionId}`, Date.now());
    if (this.fxAttemptTimes.size > 10000) this.fxAttemptTimes.delete(this.fxAttemptTimes.keys().next().value!);
  }

  private async resolvePendingFx(transaction: Transaction, baseCurrency: PersonalLedger['baseCurrency']): Promise<Pick<Transaction, 'reportingAmount' | 'fxSnapshot'> | undefined> {
    if (!this.fx) return undefined;
    try {
      const requestedDate = transaction.postingDate ?? transaction.transactionDate;
      const result = await this.fx.rates(transaction.originalAmount.currency, [baseCurrency], requestedDate);
      const rate = result.rates.find((item) => item.base === transaction.originalAmount.currency && item.quote === baseCurrency && item.requestedDate === requestedDate && item.effectiveDate <= requestedDate);
      if (!rate) return undefined;
      const converted = convertMoney(money(BigInt(transaction.originalAmount.amountMinor), transaction.originalAmount.currency), baseCurrency, rate.rateDecimal);
      const reportingAmount = { currency: converted.currency, amountMinor: converted.amountMinor.toString() };
      if (!moneySchema.safeParse(reportingAmount).success) return undefined;
      return { reportingAmount, fxSnapshot: { provider: rate.provider, rateDecimal: rate.rateDecimal, requestedDate, effectiveDate: rate.effectiveDate } };
    } catch { return undefined; }
  }
}
