import type { RecurringPayment, RecurringRule, Transaction, TransactionSplit } from '../ledger/types.js';

export type UpcomingRecurringItem = Readonly<{ rule: RecurringRule; transaction: Transaction; occurrenceDate: string }>;

export function getRecurringPayment(rule: RecurringRule, transactions: Transaction[], splits: TransactionSplit[] = []): RecurringPayment | null {
  if (rule.payment) return rule.payment;
  const template = transactions.find((item) => item.id === rule.templateTransactionId);
  if (!template || (template.transactionType !== 'income' && template.transactionType !== 'expense')) return null;
  return { accountId: template.accountId, memberId: template.memberId, categoryId: template.categoryId,
    transactionType: template.transactionType, originalAmount: template.originalAmount, description: template.description, notes: template.notes,
    splits: splits.filter((item) => item.transactionId === template.id && !item.deletedAt).map(({ categoryId, amount }) => ({ categoryId, amount })) };
}

/** A definition can be previewed without creating a financial transaction. */
export function recurringTemplate(rule: RecurringRule, transactions: Transaction[]): Transaction | undefined {
  if (!rule.payment) return transactions.find((item) => item.id === rule.templateTransactionId && !item.deletedAt);
  const { splits: _, ...payment } = rule.payment;
  return { id: rule.id, householdId: rule.householdId, createdAt: rule.createdAt, updatedAt: rule.updatedAt,
    createdByMemberId: rule.createdByMemberId, updatedByMemberId: rule.updatedByMemberId, revision: rule.revision, deletedAt: null,
    ...payment, transactionDate: rule.startsOn, postingDate: null, source: 'recurring', status: 'planned', reportingAmount: null, fxSnapshot: null };
}

export function nextOccurrence(rule: RecurringRule, afterDate: string): string | null {
  if (rule.skipThrough && rule.skipThrough > afterDate) afterDate = rule.skipThrough;
  let step = 0;
  let candidate = rule.startsOn;
  while (candidate <= afterDate) {
    step += 1;
    candidate = addInterval(rule.startsOn, rule.frequency, rule.interval * step);
  }
  return rule.endsOn && candidate > rule.endsOn ? null : candidate;
}

export function buildUpcomingItems(rules: RecurringRule[], transactions: Transaction[], afterDate: string, throughDate: string, limit = Number.POSITIVE_INFINITY): UpcomingRecurringItem[] {
  return rules.flatMap((rule) => {
    if (!rule.isActive || rule.deletedAt) return [];
    const transaction = recurringTemplate(rule, transactions);
    if (!transaction) return [];
    const items: UpcomingRecurringItem[] = [];
    let cursor = afterDate;
    let occurrenceDate = nextOccurrence(rule, cursor);
    while (occurrenceDate && occurrenceDate <= throughDate && items.length < limit) {
      items.push({ rule, transaction, occurrenceDate });
      cursor = occurrenceDate;
      occurrenceDate = nextOccurrence(rule, cursor);
    }
    return items;
  }).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)).slice(0, limit);
}

export function buildNextUpcomingItems(
  rules: RecurringRule[],
  transactions: Transaction[],
  afterDate: string,
): UpcomingRecurringItem[] {
  return rules.flatMap((rule) => {
    if (!rule.isActive || rule.deletedAt) return [];
    const transaction = recurringTemplate(rule, transactions);
    const occurrenceDate = nextOccurrence(rule, afterDate);
    return transaction && occurrenceDate ? [{ rule, transaction, occurrenceDate }] : [];
  }).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}

export function occurrencesThrough(rule: RecurringRule, throughDate: string, limit = Number.POSITIVE_INFINITY): string[] {
  if (!rule.isActive || rule.startsOn > throughDate || limit < 1) return [];
  const dates: string[] = [];
  let step = 0;
  let candidate = rule.startsOn;
  while (candidate <= throughDate && (!rule.endsOn || candidate <= rule.endsOn) && dates.length < limit) {
    if (!rule.skipThrough || candidate > rule.skipThrough) dates.push(candidate);
    step += 1;
    candidate = addInterval(rule.startsOn, rule.frequency, rule.interval * step);
  }
  return dates;
}

export function addDays(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return isoDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function addInterval(date: string, frequency: RecurringRule['frequency'], interval: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (frequency === 'monthly') {
    const targetMonth = month - 1 + interval;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    return isoDate(new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))));
  }
  const days = frequency === 'weekly' ? interval * 7 : interval;
  return isoDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }
