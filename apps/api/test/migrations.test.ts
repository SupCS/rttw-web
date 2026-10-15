import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase } from 'pg';
import { migrationOptions } from '../src/database/migrations.js';
import { checkDatabaseReadiness } from '../src/database/readiness.js';

test('personal-only reset removes financial and membership data while retaining users and sessions', async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  const dbClient = { query: async (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
    const sql = typeof input === 'string' ? input : input.text;
    const parameters = values ?? (typeof input === 'string' ? undefined : input.values);
    if (parameters?.length) return db.query(sql, parameters);
    return (await db.exec(sql)).at(-1) ?? { rows: [] };
  } } as unknown as ClientBase;
  const options = { ...migrationOptions, dbClient };
  const count = (await readdir(migrationOptions.dir)).filter(name => name.endsWith('.sql')).length;
  await assert.rejects(checkDatabaseReadiness(dbClient as never));
  await runner({ ...options, count: count - 1 });
  const userId = randomUUID(), householdId = randomUUID(), memberId = randomUUID(), sessionId = randomUUID();
  await db.query("INSERT INTO users(id,email,password_hash) VALUES($1,'retained@example.invalid','retained-hash')", [userId]);
  await db.query("INSERT INTO households(id,name,base_currency_code,created_by_user_id,updated_by_user_id) VALUES($1,'Legacy','USD',$2,$2)", [householdId, userId]);
  await db.query("INSERT INTO household_members(id,household_id,user_id,display_name,role,membership_status,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,'Owner','owner','active',$3,$3)", [memberId, householdId, userId]);
  await db.query("INSERT INTO household_invitations(id,household_id,email,token_hash,invited_by_user_id,expires_at) VALUES($1,$2,'invited@example.invalid',$3,$4,now()+interval '1 day')", [randomUUID(), householdId, 'c'.repeat(64), userId]);
  await db.query("INSERT INTO web_ledger_entities(household_id,entity_kind,id,revision,entity) VALUES($1,'account','legacy-account',1,$2)", [householdId, JSON.stringify({ id: 'legacy-account', householdId, revision: 1, openingBalances: [{ currency: 'USD', amountMinor: '999999' }] })]);
  await db.query("INSERT INTO web_recurring_occurrences(household_id,rule_id,occurrence_date,transaction_id) VALUES($1,'old-rule','2026-10-01','old-transaction')", [householdId]);
  await db.query('INSERT INTO web_operation_receipts(household_id,member_id,request_id,payload_sha256) VALUES($1,$2,$3,$4)', [householdId, memberId, randomUUID(), 'd'.repeat(64)]);
  await db.query("INSERT INTO auth_sessions(id,user_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')", [sessionId, userId, 'a'.repeat(64), 'b'.repeat(64)]);
  assert.equal((await runner(options)).length, 1);
  await checkDatabaseReadiness(dbClient as never);
  assert.equal((await runner(options)).length, 0);
  assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [userId])).rows[0]?.password_hash, 'retained-hash');
  assert.equal((await db.query('SELECT id FROM auth_sessions WHERE id=$1', [sessionId])).rows.length, 1);
  for (const name of ['households', 'household_members', 'household_invitations', 'web_ledger_entities', 'web_recurring_occurrences', 'web_operation_receipts']) {
    assert.equal((await db.query('SELECT to_regclass($1) AS relation', [`public.${name}`])).rows[0]?.relation, null);
  }
  for (const name of ['personal_ledgers', 'ledger_entities', 'ledger_recurring_occurrences', 'ledger_operation_receipts']) {
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${name}`)).rows[0]?.count, 0);
  }
  const ledgerId = randomUUID();
  await db.query("INSERT INTO personal_ledgers(id,owner_user_id,base_currency_code,created_by_user_id,updated_by_user_id) VALUES($1,$2,'USD',$2,$2)", [ledgerId, userId]);
  await assert.rejects(db.query("INSERT INTO personal_ledgers(id,owner_user_id,base_currency_code,created_by_user_id,updated_by_user_id) VALUES($1,$2,'USD',$2,$2)", [randomUUID(), userId]), { code: '23505' });
  await assert.rejects(db.query("INSERT INTO ledger_entities(ledger_id,entity_kind,id,revision,entity) VALUES($1,'account','invalid',1,$2)", [ledgerId, JSON.stringify({ id: 'invalid', ledgerId: randomUUID(), revision: 1 })]), { code: '23514' });
  await assert.rejects(runner({ ...options, direction: 'down', count }));
  assert.equal((await db.query('SELECT id FROM users')).rows.length, 1);
});
