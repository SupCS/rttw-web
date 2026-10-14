import { useEffect, useState } from 'react';
import { convertMoney, deserializeMoney, serializeMoney, type MoneyCurrencyCode, type Transaction, type WireMoney } from '@rttw/domain';
import { rates, type FxRate } from './api';
import { today } from '../format';

/** Temporary report conversions never modify persisted amounts or applied snapshots. */
export function useReportAmounts(transactions: Transaction[], currency: MoneyCurrencyCode, enabled: boolean, retry: number) {
  const [amounts, setAmounts] = useState<Record<string, WireMoney>>({});
  const [loading, setLoading] = useState(false);
  const [usedRates, setUsedRates] = useState<FxRate[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const key = JSON.stringify(transactions.map((item) => [item.id, item.originalAmount, item.reportingAmount, item.fxSnapshot, item.postingDate, item.transactionDate]));
  useEffect(() => {
    if (!enabled) { setAmounts({}); setLoading(false); return; }
    let alive = true; const result: Record<string, WireMoney> = {};
    setSourceKey(`${key}:${currency}`);
    const pending = new Map<string, Transaction[]>();
    for (const item of transactions) {
      if (item.originalAmount.currency === currency) result[item.id] = item.originalAmount;
      else if (item.reportingAmount?.currency === currency) result[item.id] = item.reportingAmount;
      else if ((item.postingDate ?? item.transactionDate) > today()) continue;
      else { const pairKey = `${item.originalAmount.currency}:${item.postingDate ?? item.transactionDate}`; pending.set(pairKey, [...(pending.get(pairKey) ?? []), item]); }
    }
    setAmounts(result); setUsedRates([]); setLoading(pending.size > 0);
    const entries = [...pending.entries()];
    const resolvedRates: FxRate[] = [];
    let cursor = 0;
    const worker = async () => {
      while (alive && cursor < entries.length) {
        const [, items] = entries[cursor++]!; const first = items[0]!;
        try {
          const response = await rates(first.originalAmount.currency, currency, first.postingDate ?? first.transactionDate);
          const rate = response.rates.find((item) => item.base === first.originalAmount.currency && item.quote === currency);
          if (!rate) continue;
          resolvedRates.push(rate);
          for (const item of items) result[item.id] = serializeMoney(convertMoney(deserializeMoney(item.originalAmount), currency, rate.rateDecimal));
        } catch { /* Missing historical rates are counted as pending by the report. */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker)).then(() => { if (alive) { setAmounts({ ...result }); setUsedRates(resolvedRates); setLoading(false); } });
    return () => { alive = false; };
  }, [key, currency, enabled, retry]);
  return { amounts: sourceKey === `${key}:${currency}` ? amounts : {}, loading: enabled && (loading || sourceKey !== `${key}:${currency}`), usedRates: sourceKey === `${key}:${currency}` ? usedRates : [] };
}
export function convertBalance(values: WireMoney[], target: MoneyCurrencyCode, available: FxRate[]): WireMoney | null {
  let total = 0n;
  for (const value of values) {
    if (value.currency === target) total += BigInt(value.amountMinor);
    else {
      const rate = available.find((item) => item.base === value.currency && item.quote === target);
      if (!rate) return null;
      total += convertMoney(deserializeMoney(value), target, rate.rateDecimal).amountMinor;
    }
  }
  return { currency: target, amountMinor: total.toString() };
}
