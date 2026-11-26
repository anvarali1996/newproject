import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from './support/pg.js';
import { takeHit, limitSwapAnalysis } from '../lib/rate-limit.js';
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

test('limitSwapAnalysis enforces the hourly burst, then the daily cap, with a 429', async t => {
  process.env.SWAP_ANALYSES_PER_HOUR = '2';
  process.env.SWAP_ANALYSES_PER_DAY = '3';
  t.after(() => { delete process.env.SWAP_ANALYSES_PER_HOUR; delete process.env.SWAP_ANALYSES_PER_DAY; });
  const user = `u${randomUUID().slice(0, 8)}`;
  await limitSwapAnalysis(sql, user);
  await limitSwapAnalysis(sql, user);
  const hourly = await limitSwapAnalysis(sql, user).catch(e => e);
  assert.equal(hourly.status, 429);
  assert.match(hourly.message, /2 videos per hour\. Try again in 60 minutes/);
  assert.equal((await sql`SELECT hits FROM rate_limits WHERE key=${`swap-analyze:day:${user}`}`)[0].hits, 2,
    'an hourly rejection does not use up the daily allowance');

  await age(`swap-analyze:hour:${user}`, 3601);
  await limitSwapAnalysis(sql, user); // 3rd of the day
  await age(`swap-analyze:hour:${user}`, 3601);
  const daily = await limitSwapAnalysis(sql, user).catch(e => e);
  assert.equal(daily.status, 429);
  assert.match(daily.message, /3 videos per day\. Try again in 24 hours/);

  const res = jsonError(daily);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 86000);
});

test('invalid env limits fall back to defaults', async t => {
  process.env.SWAP_ANALYSES_PER_HOUR = '0';
  t.after(() => { delete process.env.SWAP_ANALYSES_PER_HOUR; });
  const user = `u${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 10; i++) await limitSwapAnalysis(sql, user);
  assert.equal((await limitSwapAnalysis(sql, user).catch(e => e)).status, 429);
});
