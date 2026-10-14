import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { registerWebStatic } from '../src/web/static.js';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^rttw-static-/);
  await rm(target, { recursive: true, force: true });
}

test('built website shares an origin while preserving API routes and safe static boundaries', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'rttw-static-'));
  const directory = join(temporary, 'web');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="/assets/index-AbC123xy.js"></script></body></html>');
  await writeFile(join(directory, 'assets', 'index-AbC123xy.js'), 'document.title = "RTTW";');
  await writeFile(join(directory, 'assets', 'index-AbC123xy.css'), 'body { font-family: sans-serif; }');
  await writeFile(join(directory, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(join(temporary, 'private.txt'), 'outside-static-root');
  const app = buildApp({ logger: false });
  app.get('/api/web/example', async () => ({ source: 'api' }));
  t.after(async () => { await app.close(); await removeFixture(temporary); });
  assert.equal(await registerWebStatic(app, { directory, required: true }), true);

  const index = await app.inject('/');
  assert.equal(index.statusCode, 200);
  assert.match(index.headers['content-type'] ?? '', /^text\/html; charset=utf-8/);
  assert.equal(index.headers['cache-control'], 'no-store');
  assert.match(index.headers['content-security-policy'] ?? '', /script-src 'self'/);
  assert.match(index.headers['content-security-policy'] ?? '', /style-src 'self' 'unsafe-inline'/);
  assert.match(index.headers['content-security-policy'] ?? '', /connect-src 'self'/);
  assert.doesNotMatch(index.headers['content-security-policy'] ?? '', /script-src[^;]*unsafe-inline/);
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  assert.equal((await app.inject({ method: 'HEAD', url: '/' })).body, '');
  const script = await app.inject('/assets/index-AbC123xy.js?version=1');
  assert.equal(script.statusCode, 200);
  assert.match(script.headers['content-type'] ?? '', /^text\/javascript/);
  assert.equal(script.headers['cache-control'], 'public, max-age=31536000, immutable');
  const style = await app.inject('/assets/index-AbC123xy.css');
  assert.match(style.headers['content-type'] ?? '', /^text\/css/);
  assert.match(style.headers['cache-control'] ?? '', /immutable/);
  const icon = await app.inject('/icon.svg');
  assert.equal(icon.headers['content-type'], 'image/svg+xml');
  assert.equal(icon.headers['cache-control'], 'public, max-age=0, must-revalidate');
  assert.deepEqual((await app.inject('/api/web/example')).json(), { source: 'api' });
  assert.equal((await app.inject('/health')).json().service, 'rttw-api');
  for (const url of ['/api/unknown', '/api', '/auth/unknown', '/assets/missing.js', '/missing', '/assets/%2e%2e/%2e%2e/private.txt', '/assets/..%5c..%5cprivate.txt', '/%00private.txt']) {
    const result = await app.inject(url);
    assert.equal(result.statusCode, 404, url);
    assert.deepEqual(result.json(), { error: 'not_found' });
  }
  // A filesystem symlink must not turn a static route into a source-file reader.
  await symlink(temporary, join(directory, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await app.inject('/outside/private.txt')).statusCode, 404);
});

test('production refuses a missing build while API-only development can skip it', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'rttw-static-missing-'));
  const app = buildApp({ logger: false });
  t.after(async () => { await app.close(); await removeFixture(temporary); });
  assert.equal(await registerWebStatic(app, { directory: temporary, required: false }), false);
  await assert.rejects(registerWebStatic(app, { directory: temporary, required: true }), /Built website is missing/);
  assert.equal((await app.inject('/')).statusCode, 404);
});
