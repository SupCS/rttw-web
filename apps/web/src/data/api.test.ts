import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, sendCommand } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('remote client', () => {
  it('requires cookie credentials and mutation protection', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })); vi.stubGlobal('fetch', fetch);
    await request('/api/ledger/commands', { command: { type: 'transaction.delete' } });
    expect(fetch).toHaveBeenCalledWith('/api/ledger/commands', expect.objectContaining({ credentials: 'include', cache: 'no-store', method: 'POST', headers: { 'content-type': 'application/json', 'x-rttw-request': 'web' } }));
  });
  it('rejects unavailable network and never reports a successful write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(request('/api/ledger/commands', {})).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });
  it('preserves conflict status so the editor can retain its draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"code":"revision_conflict"}', { status: 409 })));
    await expect(request('/api/ledger/commands', {})).rejects.toBeInstanceOf(ApiError);
    await expect(request('/api/ledger/commands', {})).rejects.toMatchObject({ status: 409, code: 'revision_conflict' });
  });
  it('rejects unreadable responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Error</html>', { status: 502 })));
    await expect(request('/api/ledger')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('retains the same operation receipt when retrying an ambiguous command', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Disconnected')).mockResolvedValueOnce(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch);
    const command = { type: 'transaction.delete' as const, id: 'transaction', expectedRevision: 1 };
    await expect(sendCommand(command, 'request-id')).rejects.toMatchObject({ code: 'network_error' });
    await sendCommand(command, 'request-id');
    expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body);
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body as string)).toEqual({ command, requestId: 'request-id' });
  });
  it('refreshes an expired cookie under the shared cross-tab auth lock and retries once', async () => {
    const locks = { request: vi.fn(async (_name: string, work: () => Promise<unknown>) => work()) }; vi.stubGlobal('navigator', { locks });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"invalid_session"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"error":"invalid_session"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"user":{"id":"u"}}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await request('/api/ledger')).toEqual({ ok: true });
    expect(locks.request).toHaveBeenCalledWith('rttw-web-refresh', expect.any(Function));
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/ledger', '/api/web/auth/session', '/api/web/auth/refresh', '/api/ledger']);
  });
});
