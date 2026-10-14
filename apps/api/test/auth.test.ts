import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runner } from 'node-pg-migrate';
import type { Pool, QueryResult } from 'pg';
import { buildApp } from '../src/app.js';
import { createScryptPasswordHasher } from '../src/auth/password.js';
import { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { migrationOptions } from '../src/database/migrations.js';

function databaseAdapter(database: PGlite) {
  const query = async (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
    const sql = typeof input === 'string' ? input : input.text;
    const parameters = values ?? (typeof input === 'string' ? undefined : input.values);
    const result = parameters?.length
      ? await database.query(sql, parameters)
      : (await database.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows.length,
    } as unknown as QueryResult;
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
  } as unknown as Pool;
}

test('registration and rotatable sessions keep credentials out of storage', async (t) => {
  const database = new PGlite();
  const pool = databaseAdapter(database);
  await runner({ ...migrationOptions, dbClient: pool });
  const passwordHasher = createScryptPasswordHasher({
    cost: 1_024,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
    maxMemory: 16 * 1024 * 1024,
  });
  const app = buildApp({
    logger: false,
    authService: new AuthService(new AuthRepository(pool), passwordHasher),
  });
  t.after(async () => {
    await app.close();
    await database.close();
  });

  assert.equal((await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'invalid', password: 'short' },
  })).statusCode, 400);

  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: '  Person@Example.com ', password: 'a secure test password', deviceName: 'Pixel test phone' },
  });
  assert.equal(registration.statusCode, 201);
  assert.equal(registration.headers['cache-control'], 'no-store');
  const registered = registration.json();
  assert.equal(registered.user.email, 'person@example.com');
  assert.ok(registered.session.accessToken.length >= 32);
  assert.ok(registered.session.refreshToken.length >= 32);

  const stored = await database.query<{ email: string; password_hash: string }>('SELECT email, password_hash FROM users');
  assert.equal(stored.rows[0]?.email, 'person@example.com');
  assert.match(stored.rows[0]?.password_hash ?? '', /^scrypt\$/);
  assert.doesNotMatch(stored.rows[0]?.password_hash ?? '', /secure test password/);
  const storedSession = await database.query<{ access_token_hash: string; refresh_token_hash: string }>(
    'SELECT access_token_hash, refresh_token_hash FROM auth_sessions',
  );
  assert.notEqual(storedSession.rows[0]?.access_token_hash, registered.session.accessToken);
  assert.notEqual(storedSession.rows[0]?.refresh_token_hash, registered.session.refreshToken);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'PERSON@example.com', password: 'another secure password' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.deepEqual(duplicate.json(), { error: 'email_in_use' });

  const failedLogin = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'person@example.com', password: 'the wrong password!' },
  });
  assert.equal(failedLogin.statusCode, 401);
  assert.deepEqual(failedLogin.json(), { error: 'invalid_credentials' });

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'PERSON@example.com', password: 'a secure test password', deviceName: 'Test laptop' },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().user.email, 'person@example.com');

  const me = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${registered.session.accessToken}` },
  });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { user: registered.user });

  const refreshedResponse = await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    payload: { refreshToken: registered.session.refreshToken },
  });
  assert.equal(refreshedResponse.statusCode, 200);
  const refreshed = refreshedResponse.json();
  assert.notEqual(refreshed.session.accessToken, registered.session.accessToken);
  assert.notEqual(refreshed.session.refreshToken, registered.session.refreshToken);

  assert.equal((await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${registered.session.accessToken}` },
  })).statusCode, 401);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/auth/refresh',
    payload: { refreshToken: registered.session.refreshToken },
  })).statusCode, 401);

  const sessionsResponse = await app.inject({
    method: 'GET',
    url: '/auth/sessions',
    headers: { authorization: `Bearer ${refreshed.session.accessToken}` },
  });
  assert.equal(sessionsResponse.statusCode, 200);
  const sessions = sessionsResponse.json().sessions;
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((session: { current: boolean }) => session.current)?.deviceName, 'Pixel test phone');

  assert.equal((await app.inject({
    method: 'DELETE',
    url: `/auth/sessions/${login.json().session.sessionId}`,
    headers: { authorization: `Bearer ${refreshed.session.accessToken}` },
  })).statusCode, 204);
  assert.equal((await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${login.json().session.accessToken}` },
  })).statusCode, 401);

  const otherRegistration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'other@example.com', password: 'another secure password', deviceName: 'Other phone' },
  });
  assert.equal(otherRegistration.statusCode, 201);
  const otherSession = otherRegistration.json().session;
  const crossUserRevocation = await app.inject({
    method: 'DELETE',
    url: `/auth/sessions/${otherSession.sessionId}`,
    headers: { authorization: `Bearer ${refreshed.session.accessToken}` },
  });
  assert.equal(crossUserRevocation.statusCode, 404);
  assert.equal((await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${otherSession.accessToken}` },
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { authorization: `Bearer ${refreshed.session.accessToken}` },
  })).statusCode, 204);
  assert.equal((await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { authorization: `Bearer ${refreshed.session.accessToken}` },
  })).statusCode, 401);

  const rateLimitedApp = buildApp({
    logger: false,
    authService: new AuthService(new AuthRepository(pool), passwordHasher),
  });
  t.after(() => rateLimitedApp.close());
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await rateLimitedApp.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
    })).statusCode, 400);
  }
  const limited = await rateLimitedApp.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {},
  });
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.json(), { error: 'rate_limited' });
});
