import { describe, expect, it } from 'vitest';
import { buildNextUpcomingItems, buildUpcomingItems, nextOccurrence, occurrencesThrough } from './schedule.js';

const audit = { id: 'rule-1', householdId: 'household-1', templateTransactionId: 'transaction-1', interval: 1,
  startsOn: '2026-01-31', endsOn: null, isActive: true, createdAt: '', updatedAt: '', createdByMemberId: null,
  updatedByMemberId: null, revision: 1, deletedAt: null } as const;

describe('recurring schedule', () => {
  it('keeps end-of-month schedules on a valid calendar date', () => {
    expect(nextOccurrence({ ...audit, frequency: 'monthly' }, '2026-01-31')).toBe('2026-02-28');
  });
  it('supports every N days', () => {
    expect(nextOccurrence({ ...audit, frequency: 'interval_days', interval: 10, startsOn: '2026-09-01' }, '2026-09-02')).toBe('2026-09-11');
  });
  it('expands every occurrence in a date window', () => {
    const transaction = { id: 'transaction-1' } as never;
    const items = buildUpcomingItems([{ ...audit, frequency: 'weekly', startsOn: '2026-09-03' }], [transaction], '2026-09-01', '2026-10-01');
    expect(items.map((item) => item.occurrenceDate)).toEqual(['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01']);
  });
  it('keeps monthly occurrences anchored to the original day', () => {
    expect(nextOccurrence({ ...audit, frequency: 'monthly' }, '2026-02-28')).toBe('2026-03-31');
  });

  it('shows only the next occurrence for each recurring rule', () => {
    const transaction = { id: 'transaction-1' } as never;
    const items = buildNextUpcomingItems([{ ...audit, frequency: 'monthly' }], [transaction], '2026-02-01');
    expect(items.map((item) => item.occurrenceDate)).toEqual(['2026-02-28']);
  });

  it('lists due occurrences inclusively for offline catch-up', () => {
    expect(occurrencesThrough({ ...audit, frequency: 'monthly' }, '2026-03-31'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});
