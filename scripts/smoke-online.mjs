import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Creates isolated disposable test users; refuses remote/production destinations.
const base = new URL(process.env.RTTW_SMOKE_URL ?? 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Smoke checks are restricted to localhost.');
const origin = 'http://127.0.0.1:5173';
function client() {
  const cookies = new Map();
  return async (path, body, expected = 200) => {
    const response = await fetch(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      headers: { origin, 'x-rttw-request': 'web', ...(body ? { 'content-type': 'application/json' } : {}), cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'); const index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const result = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, `${path}: ${response.status}, error=${result?.error ?? 'none'}`);
    return result;
  };
}
const browserOne = client(); const browserTwo = client(); const outsider = client();
const email = `acceptance-${randomUUID()}@example.invalid`; const password = randomBytes(24).toString('base64url');
const identity = await browserOne('/api/web/auth/register', { email, password }, 201);
await browserTwo('/api/web/auth/login', { email, password });
await outsider('/api/web/auth/register', { email: `outsider-${randomUUID()}@example.invalid`, password }, 201);
assert.equal(identity.households.length, 0);
const householdId = identity.personalLedger.id;
const first = await browserOne(`/api/ledger?householdId=${householdId}`);
assert.ok(first.member.id); assert.equal(first.accounts.length, 0);
const audit = () => ({ id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdByMemberId: null, updatedByMemberId: null, revision: 1, deletedAt: null });
const account = { ...audit(), householdId, ownershipScope: 'personal', ownerMemberId: first.member.id, name: 'Acceptance account', accountType: 'cash', primaryCurrency: 'USD', openingBalances: [{ amountMinor: '12345', currency: 'USD' }, { amountMinor: '1000', currency: 'EUR' }], isArchived: false };
let snapshot = await browserOne('/api/ledger/commands', { householdId, command: { type: 'account.save', account, expectedRevision: 0 } });
const other = await browserTwo(`/api/ledger?householdId=${householdId}`);
assert.deepEqual(other.accounts, snapshot.accounts);
await outsider(`/api/ledger?householdId=${householdId}`, undefined, 403);
const saved = snapshot.accounts[0];
snapshot = await browserOne('/api/ledger/commands', { householdId, command: { type: 'account.save', account: { ...saved, name: 'Renamed account' }, expectedRevision: saved.revision } });
await browserTwo('/api/ledger/commands', { householdId, command: { type: 'account.save', account: { ...saved, name: 'Stale overwrite' }, expectedRevision: saved.revision } }, 409);
const date = new Date().toISOString().slice(0, 10);
const transaction = { ...audit(), householdId, accountId: saved.id, memberId: first.member.id, categoryId: null, transactionType: 'expense', transactionDate: date, postingDate: null, source: 'manual', status: 'confirmed', originalAmount: { amountMinor: '-1234', currency: 'USD' }, reportingAmount: { amountMinor: '-1234', currency: 'USD' }, fxSnapshot: null, description: 'Synthetic acceptance entry', notes: null };
snapshot = await browserOne('/api/ledger/commands', { householdId, command: { type: 'transaction.save', transaction, splits: [], expectedRevision: 0 } });
const backup = await browserOne(`/api/ledger/backup?householdId=${householdId}`);
assert.equal(backup.transactions[0].originalAmount.amountMinor, '-1234');
const restoredHousehold = await browserOne('/api/web/households', { name: 'Acceptance restore', baseCurrency: 'USD' }, 201);
const targetId = restoredHousehold.household?.id ?? restoredHousehold.id;
assert.ok(targetId);
const preview = await browserOne('/api/ledger/backup/preview', { householdId: targetId, backup });
assert.equal(preview.transactions, 1);
const restored = await browserOne('/api/ledger/restore', { householdId: targetId, backup });
assert.equal(restored.transactions[0].originalAmount.amountMinor, '-1234');
assert.deepEqual(restored.accounts[0].openingBalances, account.openingBalances);
await browserOne('/api/ledger/restore', { householdId: targetId, backup }, 409);
const damagedTarget = await browserOne('/api/web/households', { name: 'Acceptance invalid restore', baseCurrency: 'USD' }, 201);
await browserOne('/api/ledger/backup/preview', { householdId: damagedTarget.household?.id ?? damagedTarget.id, backup: { ...backup, version: 999 } }, 400);
console.log('Online acceptance passed: two independent sessions share server data; outsider denied; stale edit rejected; backup preview/restore exact; invalid/nonempty restore rejected.');
