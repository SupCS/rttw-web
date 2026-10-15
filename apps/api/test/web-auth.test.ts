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
import { HouseholdService } from '../src/households/service.js';
import { LedgerService } from '../src/ledger/service.js';

const origin = 'https://rttw.example';
const mutations = { origin, 'x-rttw-request': 'web', 'sec-fetch-site': 'same-origin' };
function cookies(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  assert.ok(Array.isArray(header));
  return header.map((value: string) => value.split(';')[0]).join('; ');
}

test('browser sessions use protected rotating cookies and defend every mutation', async (t) => {
  const pool = createLocalDatabasePool(new PGlite());
  await runner({ ...migrationOptions, dbClient: pool });
  const auth = new AuthService(new AuthRepository(pool), createScryptPasswordHasher({ cost: 1024, blockSize: 8, parallelization: 1, keyLength: 32, maxMemory: 16 * 1024 * 1024 }));
  const app = buildApp({ logger: false, authService: auth, householdService: new HouseholdService(pool), ledgerService: new LedgerService(pool), webOrigin: origin, secureWebCookies: true });
  t.after(async () => { await app.close(); await pool.end(); });
  const credentials = { email: ' Owner@Example.com ', password: 'a secure test password' };
  for (const headers of [{}, { origin }, { ...mutations, origin: 'https://evil.example' }, { ...mutations, 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/web/auth/register', headers, payload: credentials, remoteAddress: '127.0.0.2' })).statusCode, 403);
  }
  const registered = await app.inject({ method: 'POST', url: '/api/web/auth/register', headers: mutations, payload: credentials });
  assert.equal(registered.statusCode, 201);
  assert.equal(registered.headers['cache-control'], 'no-store');
  assert.equal(registered.json().user.email, 'owner@example.com');
  assert.deepEqual(registered.json().households, []);
  assert.equal(registered.json().personalLedger.role, 'owner');
  assert.doesNotMatch(registered.body, /accessToken|refreshToken|password|sessionId/);
  for (const cookie of registered.headers['set-cookie'] as string[]) {
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/api;/); assert.match(cookie, /SameSite=Lax/);
  }
  const ownerCookie = cookies(registered);
  const personalId: string = registered.json().personalLedger.id;
  assert.equal((await app.inject('/api/web/auth/session')).statusCode, 401);
  const session = await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie } });
  assert.deepEqual(session.json(), registered.json());
  const personalSessions = await Promise.all([1, 2].map(() => app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie } })));
  for (const result of personalSessions) {
    assert.equal(result.json().personalLedger.id, personalId);
    assert.deepEqual(result.json().households, []);
  }
  const emptyHouseholds = await app.inject({ method: 'GET', url: '/api/web/households', headers: { cookie: ownerCookie } });
  assert.deepEqual(emptyHouseholds.json().households, []);
  const personalSnapshot = await app.inject({ method: 'GET', url: `/api/ledger?householdId=${personalId}`, headers: { cookie: ownerCookie } });
  assert.equal(personalSnapshot.statusCode, 200);
  assert.deepEqual(personalSnapshot.json().accounts, []);
  const firstHousehold = await app.inject({ method: 'POST', url: '/api/web/households', headers: { ...mutations, cookie: ownerCookie }, payload: { name: 'Shared home', baseCurrency: 'USD' } });
  assert.equal(firstHousehold.statusCode, 201);
  const householdId: string = firstHousehold.json().household.id;
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie, origin: 'https://evil.example' } })).statusCode, 403);
  const access = ownerCookie.match(/rttw_access=([^;]+)/)?.[1];
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { authorization: `Bearer ${access}` } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { cookie: ownerCookie }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject(`/api/ledger?householdId=${householdId}`)).statusCode, 401);

  const rotations = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: '/api/web/auth/refresh', headers: { ...mutations, cookie: ownerCookie }, payload: {} })));
  assert.deepEqual(rotations.map((response) => response.statusCode).sort(), [200, 401]);
  const refreshed = rotations.find((response) => response.statusCode === 200)!;
  const rejectedRotation = rotations.find((response) => response.statusCode === 401)!;
  assert.equal(rejectedRotation.headers['set-cookie'], undefined);
  assert.equal(refreshed.statusCode, 200);
  const refreshedCookie = cookies(refreshed);
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: refreshedCookie } })).statusCode, 200);
  assert.notEqual(refreshedCookie, ownerCookie);
  assert.doesNotMatch(refreshed.body, /accessToken|refreshToken/);
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: ownerCookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/web/auth/refresh', headers: { ...mutations, cookie: ownerCookie } })).statusCode, 401);

  const other = await app.inject({ method: 'POST', url: '/api/web/auth/register', headers: mutations, payload: { email: 'guest@example.com', password: 'another secure password' } });
  assert.equal(other.statusCode, 201);
  const guestCookie = cookies(other);
  assert.deepEqual(other.json().households, []);
  assert.notEqual(other.json().personalLedger.id, personalId);
  assert.equal((await app.inject({ method: 'GET', url: `/api/ledger?householdId=${personalId}`, headers: { cookie: guestCookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `/api/web/households/${personalId}/invitations`, headers: { ...mutations, cookie: refreshedCookie }, payload: { email: 'guest@example.com' } })).statusCode, 403);
  // Even a stray membership or invitation must never grant access to a personal ledger.
  await pool.query(`INSERT INTO household_members (id, household_id, user_id, display_name, role, membership_status, created_by_user_id, updated_by_user_id)
    VALUES ($1, $2, $3, 'Stray member', 'member', 'active', $3, $3)`, [randomUUID(), personalId, other.json().user.id]);
  assert.equal((await app.inject({ method: 'GET', url: `/api/ledger?householdId=${personalId}`, headers: { cookie: guestCookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/api/ledger/backup?householdId=${personalId}`, headers: { cookie: guestCookie } })).statusCode, 403);
  const forgedToken = 'p'.repeat(43);
  await pool.query(`INSERT INTO household_invitations (id, household_id, email, token_hash, invited_by_user_id, expires_at)
    VALUES ($1, $2, 'guest@example.com', $3, $4, now() + interval '1 day')`, [randomUUID(), personalId, hashToken(forgedToken), registered.json().user.id]);
  assert.equal((await app.inject({ method: 'POST', url: `/api/web/households/invitations/${forgedToken}/accept`, headers: { ...mutations, cookie: guestCookie }, payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/web/households/${householdId}/members`, headers: { cookie: guestCookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/api/ledger?householdId=${householdId}`, headers: { cookie: guestCookie } })).statusCode, 403);
  const invited = await app.inject({ method: 'POST', url: `/api/web/households/${householdId}/invitations`, headers: { ...mutations, cookie: refreshedCookie }, payload: { email: 'GUEST@example.com' } });
  assert.equal(invited.statusCode, 201);
  const invitation = invited.json().invitation;
  const stored = await pool.query('SELECT token_hash FROM household_invitations WHERE household_id = $1', [householdId]);
  assert.notEqual(stored.rows[0].token_hash, invitation.token);
  assert.equal((await app.inject({ method: 'POST', url: `/api/web/households/invitations/${invitation.token}/accept`, headers: { ...mutations, cookie: refreshedCookie }, payload: {} })).statusCode, 404);
  const accepted = await app.inject({ method: 'POST', url: `/api/web/households/invitations/${invitation.token}/accept`, headers: { ...mutations, cookie: guestCookie }, payload: {} });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().household.role, 'member');
  assert.equal(accepted.json().household.id, householdId);
  assert.equal((await app.inject({ method: 'POST', url: `/api/web/households/invitations/${invitation.token}/accept`, headers: { ...mutations, cookie: guestCookie }, payload: {} })).statusCode, 404);
  const members = await app.inject({ method: 'GET', url: `/api/web/households/${householdId}/members`, headers: { cookie: guestCookie } });
  assert.equal(members.statusCode, 200); assert.equal(members.json().members.length, 2);
  assert.equal((await app.inject({ method: 'POST', url: `/api/web/households/${householdId}/invitations`, headers: { ...mutations, cookie: guestCookie }, payload: { email: 'third@example.com' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/api/ledger?householdId=${householdId}`, headers: { cookie: guestCookie } })).statusCode, 200);
  const guestSession = await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: guestCookie } });
  assert.equal(guestSession.json().households.length, 1);
  assert.equal(guestSession.json().personalLedger.id, other.json().personalLedger.id);
  const audit = () => ({ id: randomUUID(), createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', createdByMemberId: null, updatedByMemberId: null, revision: 1, deletedAt: null });
  const memberId: string = firstHousehold.json().household.memberId;
  const account = { ...audit(), householdId, ownershipScope: 'shared', ownerMemberId: null, name: 'Euro cash', accountType: 'cash', primaryCurrency: 'EUR', openingBalances: [{ currency: 'EUR', amountMinor: '2000' }], isArchived: false };
  const save = async (command: unknown) => app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { ...mutations, cookie: refreshedCookie }, payload: { householdId, command } });
  assert.equal((await save({ type: 'account.save', account })).statusCode, 200);
  const transaction = { ...audit(), householdId, accountId: account.id, memberId, categoryId: null, transactionType: 'expense', transactionDate: '2026-10-01', postingDate: '2026-10-02', source: 'manual', status: 'confirmed', originalAmount: { currency: 'EUR', amountMinor: '-1000' }, reportingAmount: { currency: 'USD', amountMinor: '-1250' }, fxSnapshot: { rateDecimal: '1.25', provider: 'manual', requestedDate: '2026-10-02', effectiveDate: '2026-09-30' }, description: 'Test expense', notes: null };
  const savedTransaction = await save({ type: 'transaction.save', transaction, splits: [] });
  assert.equal(savedTransaction.statusCode, 200);
  const beforeSettings = savedTransaction.json().transactions[0];
  const settingsUrl = `/api/web/households/${householdId}/settings`;
  assert.equal((await app.inject({ method: 'POST', url: settingsUrl, headers: { ...mutations, cookie: guestCookie }, payload: { name: 'Shared home', baseCurrency: 'EUR' } })).statusCode, 403);
  const updated = await app.inject({ method: 'POST', url: settingsUrl, headers: { ...mutations, cookie: refreshedCookie }, payload: { name: 'Shared home', baseCurrency: 'EUR' } });
  assert.equal(updated.statusCode, 200); assert.equal(updated.json().household.baseCurrency, 'EUR');
  const afterSettings = await app.inject({ method: 'GET', url: `/api/ledger?householdId=${householdId}`, headers: { cookie: refreshedCookie } });
  assert.deepEqual(afterSettings.json().transactions[0], beforeSettings);
  const personalAfterShared = await app.inject({ method: 'GET', url: `/api/ledger?householdId=${personalId}`, headers: { cookie: refreshedCookie } });
  assert.deepEqual(personalAfterShared.json().accounts, []);
  assert.deepEqual(personalAfterShared.json().transactions, []);
  const personalSettings = await app.inject({ method: 'POST', url: `/api/web/households/${personalId}/settings`, headers: { ...mutations, cookie: refreshedCookie }, payload: { name: 'Personal', baseCurrency: 'EUR' } });
  assert.equal(personalSettings.statusCode, 200);
  assert.equal(personalSettings.json().household.baseCurrency, 'EUR');
  const personalAccount = { ...audit(), householdId: personalId, ownershipScope: 'personal', ownerMemberId: personalSnapshot.json().member.id, name: 'Personal cash', accountType: 'cash', primaryCurrency: 'EUR', openingBalances: [{ currency: 'EUR', amountMinor: '12345' }], isArchived: false };
  const personalPayload = { householdId: personalId, command: { type: 'account.save', expectedRevision: 0, account: personalAccount } };
  assert.equal((await app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { ...mutations, cookie: guestCookie }, payload: personalPayload })).statusCode, 403);
  const personalSaved = await app.inject({ method: 'POST', url: '/api/ledger/commands', headers: { ...mutations, cookie: refreshedCookie }, payload: personalPayload });
  assert.equal(personalSaved.statusCode, 200);
  assert.deepEqual(personalSaved.json().accounts[0].openingBalances, personalAccount.openingBalances);
  const sharedAfterPersonal = await app.inject({ method: 'GET', url: `/api/ledger?householdId=${householdId}`, headers: { cookie: refreshedCookie } });
  assert.equal(sharedAfterPersonal.json().accounts.length, 1);
  assert.equal(sharedAfterPersonal.json().accounts[0].id, account.id);

  const created = await app.inject({ method: 'POST', url: '/api/web/households', headers: { ...mutations, cookie: refreshedCookie }, payload: { name: 'Family', baseCurrency: 'GEL' } });
  assert.equal(created.statusCode, 201); assert.equal(created.json().household.baseCurrency, 'GEL');
  const login = await app.inject({ method: 'POST', url: '/api/web/auth/login', headers: mutations, payload: credentials });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().personalLedger.id, personalId);
  assert.equal(login.json().households.length, 2);
  const loginCookie = cookies(login);
  const sessions = await app.inject({ method: 'GET', url: '/api/web/auth/sessions', headers: { cookie: refreshedCookie } });
  assert.equal(sessions.statusCode, 200);
  assert.doesNotMatch(sessions.body, /accessToken"|refreshToken"/);
  const secondaryId = sessions.json().sessions.find((item: { current: boolean }) => !item.current).id;
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/web/auth/sessions/${secondaryId}`, headers: { ...mutations, cookie: guestCookie } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/web/auth/sessions/${secondaryId}`, headers: { ...mutations, cookie: refreshedCookie } })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/web/auth/session', headers: { cookie: loginCookie } })).statusCode, 401);
  // Logout still revokes the refresh credential when its access cookie has expired.
  await pool.query('UPDATE auth_sessions SET access_expires_at = now() - interval \'1 minute\' WHERE access_token_hash = $1', [hashToken(refreshedCookie.match(/rttw_access=([^;]+)/)![1]!) ]);
  const logout = await app.inject({ method: 'POST', url: '/api/web/auth/logout', headers: { ...mutations, cookie: refreshedCookie } });
  assert.equal(logout.statusCode, 204);
  assert.match((logout.headers['set-cookie'] as string[])[0]!, /Max-Age=0/);
  assert.equal((await app.inject({ method: 'POST', url: '/api/web/auth/refresh', headers: { ...mutations, cookie: refreshedCookie } })).statusCode, 401);
});
