import { useCallback, useEffect, useRef, useState } from 'react';
import type { LedgerCommand, LedgerSnapshot } from '@rttw/domain';
import { ApiError, loadLedger, sendCommand } from './api';
import type { Text } from '../i18n';

export function errorText(error: unknown, t: Text): string {
  if (!(error instanceof ApiError)) return t.requestError;
  if (error.code === 'revision_conflict' || error.code === 'conflict') return t.conflictError;
  if (error.code === 'balance_changed') return t.balanceChanged;
  if (error.code === 'account_deleted') return t.deletedAccountHistory;
  if (error.code === 'invalid_credentials' || error.code === 'invalid_session') return t.authError;
  if (error.code === 'email_in_use') return t.emailInUse;
  if (error.code === 'restore_requires_empty_ledger') return t.emptyRestoreError;
  if (error.code.includes('backup')) return t.invalidBackup;
  if (error.code === 'split_amount_mismatch' || error.code === 'split_total_mismatch' || error.code === 'invalid_split') return t.splitError;
  if (error.code === 'invalid_transfer' || error.code === 'account_currency_not_found') return t.transferError;
  if (error.code === 'currency_has_transactions') return t.currencyHistoryError;
  if (error.code === 'currency_has_recurring_payments') return t.recurringCurrencyError;
  return t.requestError;
}
function commandKey(value: LedgerCommand): string { return JSON.stringify(value, (key, value: unknown) => ['createdAt', 'updatedAt'].includes(key) ? undefined : value); }
export function useLedger(userId: string, onExpired: () => void) {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const readEpoch = useRef(0);
  const attempts = useRef(new Map<string, { command: LedgerCommand; requestId: string }>());
  const onExpiredRef = useRef(onExpired); onExpiredRef.current = onExpired;
  const refresh = useCallback(async () => {
    const current = generation.current;
    const epoch = ++readEpoch.current;
    try {
      const result = await loadLedger();
      if (current !== generation.current || epoch !== readEpoch.current) return;
      if (result.userId !== userId) { setSnapshot(null); onExpiredRef.current(); return; }
      setSnapshot(result); setError(null);
    } catch (failure) {
      if (current !== generation.current || epoch !== readEpoch.current) return;
      setError(failure);
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setSnapshot(null); onExpiredRef.current(); }
    } finally { if (current === generation.current && epoch === readEpoch.current) setLoading(false); }
  }, [userId]);
  useEffect(() => {
    generation.current++; attempts.current.clear(); setSnapshot(null); setLoading(true); setError(null);
    void refresh();
    const focus = () => { if (!busyRef.current) void refresh(); };
    const poll = setInterval(focus, 30_000);
    addEventListener('focus', focus); addEventListener('online', focus);
    return () => { generation.current++; clearInterval(poll); removeEventListener('focus', focus); removeEventListener('online', focus); };
  }, [userId, refresh]);
  const command = useCallback(async (value: LedgerCommand) => {
    if (busyRef.current) throw new ApiError('busy', 409);
    busyRef.current = true; setBusy(true);
    readEpoch.current++;
    const current = generation.current;
    const key = commandKey(value);
    const attempt = attempts.current.get(key) ?? { command: value, requestId: crypto.randomUUID() };
    attempts.current.set(key, attempt);
    try {
      const result = await sendCommand(attempt.command, attempt.requestId);
      attempts.current.delete(key);
      if (result.userId !== userId) { setSnapshot(null); onExpiredRef.current(); throw new ApiError('identity_changed', 401); }
      if (current === generation.current) { setSnapshot(result); setError(null); }
      return result;
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setSnapshot(null); onExpiredRef.current(); }
      throw failure;
    } finally { busyRef.current = false; setBusy(false); }
  }, [userId]);
  return { snapshot, error, loading, busy, refresh, command };
}
