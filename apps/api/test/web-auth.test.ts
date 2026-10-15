import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import { buildApp } from '../src/app.js';
import { createScryptPasswordHasher } from '../src/auth/password.js';
import { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { hashToken } from '../src/auth/tokens.js';
import { createLocalDatabasePool } from '../src/database/local.js';
import { migrationOptions } from '../src/database/migrations.js';
import { LedgerService } from '../src/ledger/service.js';

const origin = 'https://rttw.example';
const mutations = { origin, 'x-rttw-request': 'web', 'sec-fetch-site': 'same-origin' };
function cookies(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie']; assert.ok(Array.isArray(header));
  return header.map((value: string) => value.split(';')[0]).join('; ');
}

test('personal browser sessions preserve cookie protection, isolate users and expose no household endpoints', async (t) => {
  const pool = createLocalDatabasePool(new PGlite());
  await runner({ ...migrationOptions, dbClient: pool });
  const auth = new AuthService(new AuthRepository(pool), createScryptPasswordHasher({ cost: 1024, blockSize: 8, parallelization: 1, keyLength: 32, maxMemory: 16 * 1024 * 1024 }));
  const app = buildApp({ logger: false, authService: auth, ledgerService: new LedgerService(pool), webOrigin: origin, secureWebCookies: true });
  t.after(async () => { await app.close(); await pool.end(); });
  const credentials = { email: ' Owner@Example.com ', password: 'a secure test password' };
  for (const headers of [{}, { origin }, { ...mutations, origin: 'https://evil.example' }, { ...mutations, 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/web/auth/register', headers, payload: credentials, remoteAddress: '127.0.0.2' })).statusCode, 403);
  }
  const registered = await app.inject({ method: 'POST', url: '/api/web/auth/register', headers: mutations, payload: credentials });
  assert.equal(registered.statusCode, 201); assert.equal(registered.headers['cache-control'], 'no-store');
  assert.equal(registered.json().user.email, 'owner@example.com');
  assert.deepEqual(Object.keys(registered.json()), ['user']);
  assert.doesNotMatch(registered.body, /accessToken|refreshToken|password|sessionId/);
  for (const cookie of registered.headers['set-cookie'] as string[]) {
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/api;/); assert.match(cookie, /SameSite=Lax/);
  }
  const ownerCookie = cookies(registered);
  assert.equal((await app.inject('/api/web/auth/session')).statusCode, 401);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie } })).json(), registered.json());
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie, origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { cookie: ownerCookie }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject('/api/ledger')).statusCode, 401);
  for (const url of ['/api/web/households', `/api/web/households/${randomUUID()}/members`]) {
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie: ownerCookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url, headers: { ...mutations, cookie: ownerCookie }, payload: {} })).statusCode, 404);
  }
  const initial = await app.inject({ method: 'GET', url: '/api/ledger', headers: { cookie: ownerCookie } });
  assert.equal(initial.statusCode, 200); assert.deepEqual(initial.json().accounts, []);
  const ledgerId = initial.json().ledger.id;
  const simultaneous = await Promise.all([1, 2].map(() => app.inject({ method: 'GET', url: '/api/ledger', headers: { cookie: ownerCookie } })));
  for (const result of simultaneous) assert.equal(result.json().ledger.id, ledgerId);
  const rotations = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: '/api/web/auth/refresh', headers: { ...mutations, cookie: ownerCookie }, payload: {} })));
  assert.deepEqual(rotations.map(response => response.statusCode).sort(), [200, 401]);
  const refreshed = rotations.find(response => response.statusCode === 200)!;
  assert.equal(rotations.find(response => response.statusCode === 401)!.headers['set-cookie'], undefined);
  const refreshedCookie = cookies(refreshed);
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie } })).statusCode, 401);
  const guest = await app.inject({ method: 'POST', url: '/api/web/auth/register', headers: mutations, payload: { email: 'guest@example.com', password: 'another secure password' } });
  const guestCookie = cookies(guest);
  const guestState = await app.inject({ method: 'GET', url: '/api/ledger', headers: { cookie: guestCookie } });
  assert.notEqual(guestState.json().ledger.id, ledgerId);
  const stamp = { id: randomUUID(), createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', createdByUserId: null, updatedByUserId: null, revision: 1, deletedAt: null };
  const account = { ...stamp, ledgerId, name: 'Private cash', accountType: 'cash', primaryCurrency: 'USD', openingBalances: [{ currency: 'USD', amountMinor: '9007199254740993' }], isArchived: false };
  const payload = { command: { type: 'account.save', expectedRevision: 0, account } };
  assert.equal((await app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { ...mutations, cookie: guestCookie }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/api/ledger?ledgerId=${ledgerId}`, headers: { cookie: guestCookie } })).statusCode, 400);
  const saved = await app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { ...mutations, cookie: refreshedCookie }, payload });
  assert.equal(saved.statusCode, 200); assert.deepEqual(saved.json().accounts[0].openingBalances, account.openingBalances);
  const settings = await app.inject({ method: 'POST', url: '/api/ledger/settings', headers: { ...mutations, cookie: refreshedCookie }, payload: { baseCurrency: 'EUR' } });
  assert.equal(settings.statusCode, 200); assert.equal(settings.json().ledger.baseCurrency, 'EUR');
  assert.deepEqual(settings.json().accounts[0].openingBalances, account.openingBalances);
  const guestBackup = await app.inject({ method: 'GET', url: '/api/ledger/backup', headers: { cookie: guestCookie } });
  assert.deepEqual(guestBackup.json().accounts, []); assert.equal(guestBackup.json().version, 2);
  const login = await app.inject({ method: 'POST', url: '/api/web/auth/login', headers: mutations, payload: credentials });
  assert.equal(login.statusCode, 200); const loginCookie = cookies(login);
  const sessions = await app.inject({ method: 'GET', url: '/api/web/auth/sessions', headers: { cookie: refreshedCookie } });
  assert.doesNotMatch(sessions.body, /accessToken"|refreshToken"/);
  const secondaryId = sessions.json().sessions.find((item: { current: boolean }) => !item.current).id;
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/web/auth/sessions/${secondaryId}`, headers: { ...mutations, cookie: guestCookie } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/web/auth/sessions/${secondaryId}`, headers: { ...mutations, cookie: refreshedCookie } })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: loginCookie } })).statusCode, 401);
  await pool.query("UPDATE auth_sessions SET access_expires_at=now()-interval '1 minute' WHERE access_token_hash=$1", [hashToken(refreshedCookie.match(/rttw_access=([^;]+)/)![1]!)]);
  assert.equal((await app.inject({ method: 'POST', url: '/api/web/auth/logout', headers: { ...mutations, cookie: refreshedCookie } })).statusCode, 204);
  assert.equal((await app.inject({ method: 'POST', url: '/api/web/auth/refresh', headers: { ...mutations, cookie: refreshedCookie } })).statusCode, 401);
});
