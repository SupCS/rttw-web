import type { MoneyCurrencyCode } from '../money/currencies.js';
export type WireMoney = Readonly<{ amountMinor: string; currency: MoneyCurrencyCode }>;
 type Money = WireMoney;

export type AuditFields = Readonly<{
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByMemberId: string | null;
  updatedByMemberId: string | null;
  revision: number;
  deletedAt: string | null;
}>;

export type Household = AuditFields & Readonly<{
  name: string;
  baseCurrency: MoneyCurrencyCode;
}>;

export type HouseholdMember = AuditFields & Readonly<{
  householdId: string;
  userId: string | null;
  displayName: string;
  role: 'owner' | 'member';
  membershipStatus: 'invited' | 'active' | 'left' | 'removed';
}>;

export type Account = AuditFields & Readonly<{
  householdId: string;
  ownershipScope: 'personal' | 'shared';
  ownerMemberId: string | null;
  name: string;
  accountType: 'cash' | 'debit_card' | 'credit_card' | 'current' | 'savings' | 'deposit' | 'investment' | 'debt' | 'e_wallet' | 'custom';
  primaryCurrency: MoneyCurrencyCode;
  openingBalances: Money[];
  isArchived: boolean;
}>;

export type BalanceScope =
  | Readonly<{ kind: 'household'; householdId: string }>
  | Readonly<{ kind: 'personal'; householdId: string; memberId: string }>;

export type AccountSummary = Readonly<{
  account: Account;
  currentBalances: Money[];
}>;

export type Category = AuditFields & Readonly<{
  householdId: string | null;
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
  householdId: string;
  accountId: string;
  memberId: string | null;
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
  householdId: string;
  transactionId: string;
  categoryId: string;
  amount: Money;
}>;

export type TransactionDetails = Readonly<{ transaction: Transaction; splits: TransactionSplit[] }>;

export type RecurringPayment = Readonly<{
  accountId: string;
  memberId: string | null;
  categoryId: string | null;
  transactionType: 'expense' | 'income';
  originalAmount: WireMoney;
  description: string | null;
  notes: string | null;
  splits: Array<Readonly<{ categoryId: string; amount: WireMoney }>>;
}>;

export type RecurringRule = AuditFields & Readonly<{
  householdId: string;
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
  householdId: string;
  debitTransactionId: string;
  creditTransactionId: string;
  feeTransactionId: string | null;
  sentAmount: Money;
  receivedAmount: Money;
}>;

export type LedgerSnapshot = Readonly<{
  household: Household;
  member: HouseholdMember;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  splits: TransactionSplit[];
  transferLinks: TransferLink[];
  recurringRules: RecurringRule[];
}>;

export type LedgerCommand =
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
  version: 1;
  exportedAt: string;
  household: Household;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  splits: TransactionSplit[];
  transferLinks: TransferLink[];
  recurringRules: RecurringRule[];
  recurringOccurrences: Array<{ ruleId: string; occurrenceDate: string; transactionId: string }>;
}>;

export interface LedgerRepository {
  saveHousehold(household: Household): Promise<void>;
  getActiveHousehold(): Promise<Household | null>;
  saveMember(member: HouseholdMember): Promise<void>;
  getActiveMember(householdId: string): Promise<HouseholdMember | null>;
  saveAccount(account: Account): Promise<void>;
  getAccount(accountId: string): Promise<Account | null>;
  listAccounts(householdId: string): Promise<Account[]>;
  listAccountSummaries(householdId: string): Promise<AccountSummary[]>;
  getBalances(scope: BalanceScope): Promise<Money[]>;
  saveCategory(category: Category): Promise<void>;
  getCategory(categoryId: string): Promise<Category | null>;
  listCategories(householdId: string): Promise<Category[]>;
  saveTransaction(transaction: Transaction, splits: TransactionSplit[]): Promise<void>;
  getTransaction(transactionId: string): Promise<TransactionDetails | null>;
  listTransactions(householdId: string): Promise<Transaction[]>;
  saveRecurringRule(rule: RecurringRule): Promise<void>;
  getRecurringRuleForTransaction(transactionId: string): Promise<RecurringRule | null>;
  listRecurringRules(householdId: string): Promise<RecurringRule[]>;
  listRecurringOccurrenceDates(ruleId: string): Promise<string[]>;
  materializeRecurringOccurrence(value: RecurringOccurrenceMaterialization): Promise<boolean>;
  deleteRecurringRuleForTransaction(transactionId: string, deletedAt: string, updatedByMemberId: string): Promise<void>;
  completePendingFx(transactionId: string, reportingAmount: Money, fxSnapshot: NonNullable<Transaction['fxSnapshot']>, updatedAt: string): Promise<boolean>;
  softDeleteTransaction(transactionId: string, deletedAt: string, updatedByMemberId: string): Promise<void>;
  restoreTransaction(transactionId: string, updatedAt: string, updatedByMemberId: string): Promise<void>;
  saveTransfer(debit: Transaction, credit: Transaction, link: TransferLink, fee?: Transaction): Promise<void>;
}
