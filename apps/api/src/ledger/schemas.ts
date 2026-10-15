import { z } from 'zod';

export const idSchema = z.string().min(1).max(160);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  if (value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const timestamp = z.iso.datetime({ offset: true });
const currency = z.enum(['CHF', 'EUR', 'GBP', 'GEL', 'JPY', 'KWD', 'PLN', 'RUB', 'TRY', 'UAH', 'USD']);
export const moneySchema = z.object({
  amountMinor: z.string().regex(/^-?(?:0|[1-9]\d*)$/).max(20).refine((value) => {
    if (!/^-?(?:0|[1-9]\d*)$/.test(value) || value.length > 20) return false;
    const amount = BigInt(value);
    return amount >= -9223372036854775808n && amount <= 9223372036854775807n;
  }),
  currency,
}).strict();
const audit = {
  id: idSchema, createdAt: timestamp, updatedAt: timestamp,
  createdByUserId: idSchema.nullable(), updatedByUserId: idSchema.nullable(),
  revision: z.number().int().positive(), deletedAt: timestamp.nullable(),
};
export const accountSchema = z.object({
  ...audit, ledgerId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  accountType: z.enum(['cash', 'debit_card', 'credit_card', 'current', 'savings', 'deposit', 'investment', 'debt', 'e_wallet', 'custom']),
  primaryCurrency: currency, openingBalances: z.array(moneySchema).min(1).max(32), isArchived: z.boolean(),
}).strict();
export const categorySchema = z.object({
  ...audit, ledgerId: z.uuid().nullable(), parentId: idSchema.nullable(),
  applicability: z.enum(['expense', 'income', 'both']), systemKey: z.string().max(120).nullable(),
  names: z.object({ en: z.string().trim().min(1).max(120), uk: z.string().trim().min(1).max(120), ru: z.string().trim().min(1).max(120) }).strict(),
  icon: z.string().max(80).nullable(), colorToken: z.string().max(80).nullable(), iconColor: z.string().max(80).nullable(),
  isArchived: z.boolean(),
}).strict();
export const transactionSchema = z.object({
  ...audit, ledgerId: z.uuid(), accountId: idSchema, categoryId: idSchema.nullable(),
  transactionType: z.enum(['expense', 'income', 'transfer', 'refund', 'adjustment', 'debt_payment']),
  transactionDate: dateSchema, postingDate: dateSchema.nullable(),
  source: z.enum(['manual', 'import', 'recurring', 'bank_api']), status: z.enum(['planned', 'confirmed', 'fx_pending', 'review']),
  originalAmount: moneySchema, reportingAmount: moneySchema.nullable(),
  fxSnapshot: z.object({ rateDecimal: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(80).refine((value) => /[1-9]/.test(value)), provider: z.string().min(1).max(120), requestedDate: dateSchema, effectiveDate: dateSchema }).strict().nullable(),
  description: z.string().max(1000).nullable(), notes: z.string().max(10000).nullable(),
}).strict();
export const splitSchema = z.object({
  ...audit, ledgerId: z.uuid(), transactionId: idSchema, categoryId: idSchema, amount: moneySchema,
}).strict();
export const transferSchema = z.object({
  ...audit, ledgerId: z.uuid(), debitTransactionId: idSchema, creditTransactionId: idSchema, feeTransactionId: idSchema.nullable(),
  sentAmount: moneySchema, receivedAmount: moneySchema,
}).strict();
export const recurringSchema = z.object({
  ...audit, ledgerId: z.uuid(), templateTransactionId: idSchema.nullable(),
  payment: z.object({
    accountId: idSchema, categoryId: idSchema.nullable(), transactionType: z.enum(['expense', 'income']),
    originalAmount: moneySchema, description: z.string().max(1000).nullable(), notes: z.string().max(10000).nullable(),
    splits: z.array(z.object({ categoryId: idSchema, amount: moneySchema }).strict()).max(500),
  }).strict().optional(),
  skipThrough: dateSchema.nullable().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'interval_days']), interval: z.number().int().min(1).max(36500),
  startsOn: dateSchema, endsOn: dateSchema.nullable(), isActive: z.boolean(),
}).strict();
const revision = z.number().int().nonnegative().nullable();
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('account.save'), account: accountSchema, expectedRevision: revision.optional() }).strict(),
  z.object({ type: z.literal('account.delete'), id: idSchema, expectedRevision: revision, asOf: dateSchema, expectedBalances: z.array(moneySchema).min(1).max(32), destinationAccountId: idSchema.nullable() }).strict(),
  z.object({ type: z.literal('category.delete'), id: idSchema, expectedRevision: revision }).strict(),
  z.object({ type: z.literal('category.save'), category: categorySchema, expectedRevision: revision.optional() }).strict(),
  z.object({ type: z.literal('transaction.save'), transaction: transactionSchema, splits: z.array(splitSchema).max(500), expectedRevision: revision.optional() }).strict(),
  z.object({ type: z.literal('transfer.create'), debit: transactionSchema, credit: transactionSchema, link: transferSchema, fee: transactionSchema.optional() }).strict(),
  z.object({ type: z.literal('recurring.save'), rule: recurringSchema, expectedRevision: revision.optional(), asOf: dateSchema.optional() }).strict(),
  ...(['transaction.delete', 'transaction.restore', 'transaction.copy', 'recurring.delete'] as const).map((type) => z.object({ type: z.literal(type), id: idSchema, expectedRevision: revision }).strict()),
  z.object({ type: z.literal('category.merge'), sourceCategoryId: idSchema, targetCategoryId: idSchema, expectedRevision: revision }).strict(),
]);
export const backupSchema = z.object({
  format: z.literal('rttw-web-ledger'), version: z.literal(2), exportedAt: timestamp,
  ledger: z.object({ ...audit, baseCurrency: currency }).strict(),
  accounts: z.array(accountSchema).max(10000), categories: z.array(categorySchema).max(10000),
  transactions: z.array(transactionSchema).max(100000), splits: z.array(splitSchema).max(500000),
  transferLinks: z.array(transferSchema).max(50000), recurringRules: z.array(recurringSchema).max(10000),
  recurringOccurrences: z.array(z.object({ ruleId: idSchema, occurrenceDate: dateSchema, transactionId: idSchema }).strict()).max(100000),
}).strict();

export type ParsedCommand = z.infer<typeof commandSchema>;
export type LedgerBackup = z.infer<typeof backupSchema>;

export const ledgerSettingsSchema = z.object({ baseCurrency: currency }).strict();
