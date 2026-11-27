import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from './support/pg.js';
import { takeHit, enforceRateLimit, limitsFor, POLICIES } from '../lib/rate-limit.js';
import { jsonError } from '../lib/errors.js';

let sql;
before(async () => { sql = await createDb(); });
const key = () => `test:${randomUUID()}`;
const age = (k, seconds) => sql`UPDATE rate_limits SET window_start = now() - ${seconds}::int * interval '1 second' WHERE key = ${k}`;

test('takeHit allows exactly `limit` hits per window', async () => {
  const k = key(), opts = { limit: 3, windowSeconds: 3600 };
  for (let i = 0; i < 3; i++) assert.equal((await takeHit(sql, k, opts)).ok, true);
  const blocked = await takeHit(sql, k, opts);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 3500 && blocked.retryAfter <= 3600, String(blocked.retryAfter));
});

test('blocked attempts are not counted, and the window resets', async () => {
  const k = key(), opts = { limit: 2, windowSeconds: 60 };
  await takeHit(sql, k, opts); await takeHit(sql, k, opts);
  for (let i = 0; i < 5; i++) await takeHit(sql, k, opts);
  assert.equal((await sql`SELECT hits FROM rate_limits WHERE key=${k}`)[0].hits, 2);
  await age(k, 50);
  assert.ok((await takeHit(sql, k, opts)).retryAfter <= 10, 'retryAfter counts down');
  await age(k, 61);
  assert.equal((await takeHit(sql, k, opts)).ok, true);
  assert.equal((await sql`SELECT hits FROM rate_limits WHERE key=${k}`)[0].hits, 1);
});

test('limits are per key', async () => {
  const a = key(), b = key(), opts = { limit: 1, windowSeconds: 3600 };
  assert.equal((await takeHit(sql, a, opts)).ok, true);
  assert.equal((await takeHit(sql, a, opts)).ok, false);
  assert.equal((await takeHit(sql, b, opts)).ok, true);
});

test('enforceRateLimit applies the hourly burst, then the daily cap, with a 429', async t => {
  process.env.SWAP_ANALYSES_PER_HOUR = '2';
  process.env.SWAP_ANALYSES_PER_DAY = '3';
  t.after(() => { delete process.env.SWAP_ANALYSES_PER_HOUR; delete process.env.SWAP_ANALYSES_PER_DAY; });
  const user = `u${randomUUID().slice(0, 8)}`;
  const limit = () => enforceRateLimit(sql, 'swap-analyze', user);
  await limit();
  await limit();
  const hourly = await limit().catch(e => e);
  assert.equal(hourly.status, 429);
  assert.match(hourly.message, /limit of 2 video scans per hour\. Try again in 60 minutes/);
  assert.equal((await sql`SELECT hits FROM rate_limits WHERE key=${`swap-analyze:day:${user}`}`)[0].hits, 2,
    'an hourly rejection does not use up the daily allowance');

  await age(`swap-analyze:hour:${user}`, 3601);
  await limit(); // 3rd of the day
  await age(`swap-analyze:hour:${user}`, 3601);
  const daily = await limit().catch(e => e);
  assert.equal(daily.status, 429);
  assert.match(daily.message, /limit of 3 video scans per day\. Try again in 24 hours/);

  const res = jsonError(daily);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 86000);
});

test('each action has its own counters and limits', async t => {
  process.env.UPLOADS_PER_HOUR = '1';
  t.after(() => { delete process.env.UPLOADS_PER_HOUR; });
  const user = `u${randomUUID().slice(0, 8)}`;
  await enforceRateLimit(sql, 'upload', user);
  const blocked = await enforceRateLimit(sql, 'upload', user).catch(e => e);
  assert.equal(blocked.status, 429);
  assert.match(blocked.message, /1 uploads per hour/);
  await enforceRateLimit(sql, 'generate', user); // not blocked by the upload limit
  await enforceRateLimit(sql, 'swap-analyze', user);
});

test('defaults: a swap fits the upload burst, and invalid env values fall back', async t => {
  assert.deepEqual(limitsFor('swap-analyze'), { perHour: 10, perDay: 30 });
  assert.deepEqual(limitsFor('generate'), { perHour: 20, perDay: 100 });
  assert.deepEqual(limitsFor('upload'), { perHour: 60, perDay: 300 });
  // A full swap (video + 4 portraits) for every allowed scan must fit the upload limit.
  assert.ok(limitsFor('upload').perHour >= 5 * limitsFor('swap-analyze').perHour);
  for (const bad of ['0', '-5', '2.5', 'abc', '1001']) {
    process.env.GENERATIONS_PER_HOUR = bad;
    assert.equal(limitsFor('generate').perHour, POLICIES.generate.perHour, bad);
  }
  delete process.env.GENERATIONS_PER_HOUR;
  assert.throws(() => limitsFor('nope'));
});
