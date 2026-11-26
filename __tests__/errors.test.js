import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, badRequest, jsonError, providerError, readJson, isTransient } from '../lib/errors.js';

// Keep test output clean; jsonError logs server-side failures on purpose.
test.beforeEach(t => { t.mock.method(console, 'error', () => {}); });

test('HttpError keeps its status and user-facing message', async () => {
  const res = jsonError(badRequest('Invalid preset'));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Invalid preset' });
});

test('unexpected errors never leak internals to the client', async () => {
  const res = jsonError(new Error('Missing DATABASE_URL postgres://user:secret@host'));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.doesNotMatch(body.error, /DATABASE_URL|secret/);
});

test('provider 429/5xx are transient 503s', () => {
  for (const status of [429, 500, 503]) {
    const e = providerError('Runway', status, { error: 'overloaded' });
    assert.equal(e.status, 503);
    assert.ok(isTransient(e));
  }
});

test('provider 400 passes a short detail through as a 400', () => {
  const e = providerError('Runway', 400, { error: 'Image aspect ratio is too extreme' });
  assert.equal(e.status, 400);
  assert.match(e.message, /aspect ratio/);
  assert.equal(isTransient(e), false);
});

test('provider auth failures hide the detail from the user', () => {
  const e = providerError('Runway', 401, { error: 'API key sk_live_123 revoked' });
  assert.equal(e.status, 502);
  assert.doesNotMatch(e.message, /sk_live|revoked/);
});

test('readJson rejects malformed and non-object bodies with 400', async () => {
  const make = body => new Request('http://x', { method: 'POST', body });
  for (const body of ['{oops', 'null', '[1,2]', '"text"']) {
    await assert.rejects(readJson(make(body)), e => e instanceof HttpError && e.status === 400);
  }
  assert.deepEqual(await readJson(make('{"a":1}')), { a: 1 });
});
