import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('health stays available without a database; readiness does not', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());
  assert.equal((await app.inject('/health')).statusCode, 200);
  assert.equal((await app.inject('/ready')).statusCode, 503);
});

test('readiness recovers after database failure without leaking details', async (t) => {
  let unavailable = true;
  const app = buildApp({ logger: false, checkDatabase: async () => {
    if (unavailable) throw new Error('postgresql://secret:password@host/private');
  } });
  t.after(() => app.close());
  const failure = await app.inject('/ready');
  assert.equal(failure.statusCode, 503);
  assert.deepEqual(failure.json(), { service: 'rttw-api', status: 'not_ready' });
  unavailable = false;
  assert.equal((await app.inject('/ready')).statusCode, 200);
});

test('unknown routes and unexpected failures do not echo sensitive input', async (t) => {
  const app = buildApp({ logger: false });
  app.get('/failure', async () => { throw new Error('private database detail'); });
  t.after(() => app.close());
  assert.deepEqual((await app.inject('/missing?token=private')).json(), { error: 'not_found' });
  const failure = await app.inject('/failure');
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(failure.json(), { error: 'internal_error' });
});
