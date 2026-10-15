import type { LedgerCommand, LedgerSnapshot, MoneyCurrencyCode } from '@rttw/domain';
import { today } from '../format';

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** Cookie credentials remain HttpOnly. Failed requests never create local ledger data. */
async function perform<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    response = await fetch(path, { credentials: 'include', cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-rttw-request': 'web' }, body: JSON.stringify(body) }),
    });
  } catch { throw new ApiError('network_error', 0); } finally { clearTimeout(timeout); }
  let result: unknown;
  try { result = response.status === 204 ? undefined : await response.json(); } catch { throw new ApiError('invalid_response', response.status); }
  if (!response.ok) {
    const error = result as { code?: string; error?: string } | null;
    throw new ApiError(error?.code ?? error?.error ?? 'request_failed', response.status);
  }
  return result as T;
}

let refreshing: Promise<unknown> | null = null;
async function refreshCookies() {
  const rotate = async () => {
    try { return await perform('/api/web/auth/session'); } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 401) throw failure;
    }
    try { return await perform('/api/web/auth/refresh', {}); } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 401) throw failure;
      // Without Web Locks another tab may already have replaced the shared cookies.
      return perform('/api/web/auth/session');
    }
  };
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('rttw-web-refresh', rotate) : rotate();
}
async function authLock<T>(work: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('rttw-web-refresh', work) : work();
}
function announceAuthChange() {
  if (typeof BroadcastChannel !== 'undefined' && typeof window !== 'undefined') { const channel = new BroadcastChannel('rttw-auth'); channel.postMessage({ type: 'changed' }); channel.close(); }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  try {
    if (/\/auth\/(login|register|logout)$/.test(path)) {
      const result = await authLock(() => perform<T>(path, body)); announceAuthChange(); return result;
    }
    return await perform<T>(path, body);
  } catch (failure) {
    if (!(failure instanceof ApiError) || failure.status !== 401 || /\/auth\/(login|register|logout|refresh)$/.test(path)) throw failure;
    refreshing ??= refreshCookies().finally(() => { refreshing = null; });
    await refreshing;
    return perform<T>(path, body);
  }
}

export type WebUser = { id: string; email: string };
export type WebHousehold = { id: string; name: string; baseCurrency: MoneyCurrencyCode; memberId: string; role: 'owner' | 'member' };
export type WebSession = { user: WebUser; personalLedger: WebHousehold | null; households: WebHousehold[] };
export const session = () => request<WebSession>('/api/web/auth/session');
export const authenticate = (mode: 'login' | 'register', email: string, password: string) => request<WebSession>(`/api/web/auth/${mode}`, { email, password });
export const logout = () => request<void>('/api/web/auth/logout', {});
export const loadLedger = (householdId: string) => request<LedgerSnapshot>(`/api/ledger?householdId=${encodeURIComponent(householdId)}&throughDate=${today()}`);
export const sendCommand = (householdId: string, command: LedgerCommand, requestId: string = crypto.randomUUID()) => request<LedgerSnapshot>('/api/ledger/commands', { householdId, command, requestId });
export type FxRate = { base: MoneyCurrencyCode; quote: MoneyCurrencyCode; rateDecimal: string; requestedDate: string; effectiveDate: string; provider: string };
export type FxResult = { rates: FxRate[]; fetchedAt: string; stale?: boolean };
export const rates = (base: MoneyCurrencyCode, quote: MoneyCurrencyCode, date: string) => request<FxResult>(`/api/fx/rates?base=${base}&quotes=${quote}&date=${date}`);
export const history = (base: MoneyCurrencyCode, quote: MoneyCurrencyCode, from: string, to: string) => request<FxResult>(`/api/fx/history?base=${base}&quote=${quote}&from=${from}&to=${to}`);
