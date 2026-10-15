import type { MoneyCurrencyCode } from '../money/currencies.js';
export type WireMoney = Readonly<{ amountMinor: string; currency: MoneyCurrencyCode }>;
 type Money = WireMoney;

export type AuditFields = Readonly<{
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  revision: number;
  deletedAt: string | null;
}>;

export type PersonalLedger = AuditFields & Readonly<{
  baseCurrency: MoneyCurrencyCode;
}>;

export type Account = AuditFields & Readonly<{
  ledgerId: string;
  name: string;
  accountType: 'cash' | 'debit_card' | 'credit_card' | 'current' | 'savings' | 'deposit' | 'investment' | 'debt' | 'e_wallet' | 'custom';
  primaryCurrency: MoneyCurrencyCode;
  openingBalances: Money[];
  isArchived: boolean;
}>;

export type AccountSummary = Readonly<{
  account: Account;
  currentBalances: Money[];
}>;

export type Category = AuditFields & Readonly<{
  ledgerId: string | null;
  parentId: string | null;
  applicability: 'expense' | 'income' | 'both';
  systemKey: string | null;
  names: Readonly<{ en: string; uk: string; ru: string }>;
  icon: string | null;
  colorToken: string | null;
  iconColor: string | null;
  isArchived: boolean;
}>;

export type Transaction = AuditFields & Readonly<{
  ledgerId: string;
  accountId: string;
  categoryId: string | null;
  transactionType: 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment' | 'debt_payment';
  transactionDate: string;
  postingDate: string | null;
  source: 'manual' | 'import' | 'recurring' | 'bank_api';
  status: 'planned' | 'confirmed' | 'fx_pending' | 'review';
  originalAmount: Money;
  reportingAmount: Money | null;
  fxSnapshot: Readonly<{
    rateDecimal: string;
    provider: string;
    requestedDate: string;
    effectiveDate: string;
  }> | null;
  description: string | null;
  notes: string | null;
}>;

export type TransactionSplit = AuditFields & Readonly<{
  ledgerId: string;
  transactionId: string;
  categoryId: string;
  amount: Money;
}>;

export type TransactionDetails = Readonly<{ transaction: Transaction; splits: TransactionSplit[] }>;

export type RecurringPayment = Readonly<{
  accountId: string;
  categoryId: string | null;
  transactionType: 'expense' | 'income';
  originalAmount: WireMoney;
  description: string | null;
  notes: string | null;
  splits: Array<Readonly<{ categoryId: string; amount: WireMoney }>>;
}>;

export type RecurringRule = AuditFields & Readonly<{
  ledgerId: string;
  templateTransactionId: string | null;
  payment?: RecurringPayment | undefined;
  skipThrough?: string | null | undefined;
  frequency: 'daily' | 'weekly' | 'monthly' | 'interval_days';
  interval: number;
  startsOn: string;
  endsOn: string | null;
  isActive: boolean;
}>;

export type RecurringOccurrenceMaterialization = Readonly<{
  ruleId: string;
  occurrenceDate: string;
  transaction: Transaction;
  splits: TransactionSplit[];
  usesTemplateTransaction: boolean;
  materializedAt: string;
}>;

export type TransferLink = AuditFields & Readonly<{
  ledgerId: string;
  debitTransactionId: string;
  creditTransactionId: string;
  feeTransactionId: string | null;
  sentAmount: Money;
  receivedAmount: Money;
}>;

export type MonthlyBudget = AuditFields & Readonly<{
  ledgerId: string;
  month: string;
  currency: MoneyCurrencyCode;
  totalLimitMinor: string | null;
  categoryLimits: Array<Readonly<{ categoryId: string; limitMinor: string }>>;
}>;

export type LedgerSnapshot = Readonly<{
  ledger: PersonalLedger;
  userId: string;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  splits: TransactionSplit[];
  transferLinks: TransferLink[];
  recurringRules: RecurringRule[];
  budgets: MonthlyBudget[];
}>;

export type LedgerCommand =
  | { type: 'budget.save'; budget: MonthlyBudget; expectedRevision?: number }
  | { type: 'budget.delete'; id: string; expectedRevision: number }
  | { type: 'account.save'; account: Account; expectedRevision?: number }
  | { type: 'account.delete'; id: string; expectedRevision: number; asOf: string; expectedBalances: WireMoney[]; destinationAccountId: string | null }
  | { type: 'category.delete'; id: string; expectedRevision: number }
  | { type: 'category.save'; category: Category; expectedRevision?: number }
  | { type: 'transaction.save'; transaction: Transaction; splits: TransactionSplit[]; expectedRevision?: number }
  | { type: 'transfer.create'; debit: Transaction; credit: Transaction; link: TransferLink; fee?: Transaction }
  | { type: 'transaction.delete' | 'transaction.restore' | 'transaction.copy'; id: string; expectedRevision: number }
  | { type: 'recurring.save'; rule: RecurringRule; expectedRevision?: number; asOf?: string }
  | { type: 'recurring.delete'; id: string; expectedRevision: number }
  | { type: 'category.merge'; sourceCategoryId: string; targetCategoryId: string; expectedRevision: number };

export type FxRate = Readonly<{
  base: MoneyCurrencyCode;
  quote: MoneyCurrencyCode;
  rateDecimal: string;
  requestedDate: string;
  effectiveDate: string;
  provider: 'frankfurter' | 'nbg' | 'manual';
}>;

export type LedgerBackup = Readonly<{
  format: 'rttw-web-ledger';
  version: 2;
  exportedAt: string;
  ledger: PersonalLedger;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  splits: TransactionSplit[];
  transferLinks: TransferLink[];
  recurringRules: RecurringRule[];
  budgets: MonthlyBudget[];
  recurringOccurrences: Array<{ ruleId: string; occurrenceDate: string; transactionId: string }>;
}>;

