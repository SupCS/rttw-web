import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { ClientBase } from 'pg';
import { migrationOptions } from '../src/database/migrations.js';
import { checkDatabaseReadiness } from '../src/database/readiness.js';

test('identity migrations apply once and enforce membership and identity constraints', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Run the actual migration runner against PostgreSQL WASM, including its history table.
  const dbClient = {
    query: async (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
      const sql = typeof input === 'string' ? input : input.text;
      const parameters = values ?? (typeof input === 'string' ? undefined : input.values);
      if (parameters?.length) return db.query(sql, parameters);
      const results = await db.exec(sql);
      return results.at(-1) ?? { rows: [] };
    },
  } as unknown as ClientBase;
  const options = { ...migrationOptions, dbClient };
  await assert.rejects(checkDatabaseReadiness(dbClient as never));
  const migrationCount = (await readdir(migrationOptions.dir)).filter((name) => name.endsWith('.sql')).length;
  assert.equal((await runner(options)).length, migrationCount);
  await checkDatabaseReadiness(dbClient as never);
  assert.equal((await runner(options)).length, 0);
  const userId = randomUUID();
  const householdId = randomUUID();
  await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [userId, 'test@example.invalid', 'test-only-hash']);
  await assert.rejects(db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [randomUUID(), 'test@example.invalid', 'hash']), { code: '23505' });
  await assert.rejects(db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [randomUUID(), 'TEST@example.invalid', 'hash']), { code: '23514' });
  await db.query(`INSERT INTO households (id, name, base_currency_code, created_by_user_id, updated_by_user_id)
    VALUES ($1, 'Test household', 'USD', $2, $2)`, [householdId, userId]);
  const insertMembership = (household: string, role = 'owner') => db.query(`
    INSERT INTO household_members (id, household_id, user_id, display_name, role, membership_status, created_by_user_id, updated_by_user_id)
    VALUES ($1, $2, $3, 'Test member', $4, 'active', $3, $3)`, [randomUUID(), household, userId, role]);
  await assert.rejects(insertMembership(randomUUID()), { code: '23503' });
  await assert.rejects(insertMembership(householdId, 'admin'), { code: '23514' });
  await insertMembership(householdId);
  await assert.rejects(insertMembership(householdId), { code: '23505' });
  const personalId = randomUUID();
  await db.query(`INSERT INTO households (id, name, base_currency_code, created_by_user_id, updated_by_user_id, personal_owner_user_id)
    VALUES ($1, 'Personal', 'USD', $2, $2, $2)`, [personalId, userId]);
  await assert.rejects(db.query(`INSERT INTO households (id, name, base_currency_code, created_by_user_id, updated_by_user_id, personal_owner_user_id)
    VALUES ($1, 'Duplicate personal', 'USD', $2, $2, $2)`, [randomUUID(), userId]), { code: '23505' });
  const otherUserId = randomUUID();
  await db.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [otherUserId, 'other@example.invalid', 'test-only-hash']);
  await assert.rejects(db.query(`INSERT INTO households (id, name, base_currency_code, created_by_user_id, updated_by_user_id, personal_owner_user_id)
    VALUES ($1, 'Wrong owner', 'USD', $2, $2, $3)`, [randomUUID(), userId, otherUserId]), { code: '23514' });
  await assert.rejects(db.query(`
    INSERT INTO auth_sessions (
      id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at
    ) VALUES ($1, $2, 'not-a-hash', 'also-not-a-hash', now() + interval '15 minutes', now() + interval '30 days')
  `, [randomUUID(), userId]), { code: '23514' });
  // Rolling back all schema history cannot remove identity/financial records;
  // disposable cache migrations may independently support rollback.
  await assert.rejects(runner({ ...options, direction: 'down', count: migrationCount }));
  assert.equal((await db.query('SELECT id FROM users')).rows.length, 2);
});
