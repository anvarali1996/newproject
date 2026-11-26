// Runs the credit SQL against a real Postgres engine (PGlite, in-process) with
// the project's own migrations, so billing regressions fail CI, not users.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from './support/pg.js';
import * as B from '../lib/billing.js';

let sql;
const credits = async id => (await sql`SELECT credits FROM users WHERE id=${id}`)[0].credits;
const user = async credits => { const id = `u${randomUUID().slice(0, 8)}`; await sql`INSERT INTO users(id,credits) VALUES (${id},${credits})`; return id; };
const job = (userId, o = {}) => ({ id: randomUUID(), userId, sourceKey: `uploads/${userId}/a.jpg`, secondaryKey: null,
  mode: 'image', prompt: 'Animate it', seconds: 5, cost: 5, provider: 'runway', ...o });
const project = async (userId, status = 'SUBMITTING') => {
  const id = randomUUID();
  await sql`INSERT INTO swap_projects(id,user_id,video_key,seconds,status) VALUES (${id},${userId},'k',4,${status})`;
  return id;
};

before(async () => { sql = await createDb(); });

test('debitAndCreateJob charges and records the job together', async () => {
  const u = await user(20), j = job(u);
  assert.equal(await B.debitAndCreateJob(sql, j), 15);
  assert.equal((await sql`SELECT status FROM jobs WHERE id=${j.id}`)[0].status, 'STARTING');
});

test('debitAndCreateJob with too few credits charges nothing and creates nothing', async () => {
  const u = await user(3), j = job(u, { cost: 10 });
  assert.equal(await B.debitAndCreateJob(sql, j), null);
  assert.equal(await credits(u), 3);
  assert.equal((await sql`SELECT count(*)::int AS n FROM jobs WHERE id=${j.id}`)[0].n, 0);
});

test('a failed job insert rolls the debit back (credits were lost before)', async () => {
  const u = await user(20);
  await assert.rejects(B.debitAndCreateJob(sql, job(u, { mode: 'bogus' })));
  assert.equal(await credits(u), 20);
});

test('failAndRefundJob refunds exactly once', async () => {
  const u = await user(20), j = job(u);
  await B.debitAndCreateJob(sql, j);
  assert.equal(await B.failAndRefundJob(sql, j.id, 'Task could not start'), true);
  assert.equal(await B.failAndRefundJob(sql, j.id, 'again'), false);
  assert.equal(await credits(u), 20);
});

test('failAndRefundJob never refunds a succeeded job', async () => {
  const u = await user(20), j = job(u);
  await B.debitAndCreateJob(sql, j);
  await sql`UPDATE jobs SET status='SUCCEEDED' WHERE id=${j.id}`;
  assert.equal(await B.failAndRefundJob(sql, j.id, 'x'), false);
  assert.equal(await credits(u), 15);
});

test('refundStuckJob refunds only old STARTING jobs without a provider task', async () => {
  const u = await user(20), fresh = job(u), started = job(u);
  await B.debitAndCreateJob(sql, fresh);
  assert.equal(await B.refundStuckJob(sql, fresh.id), false, 'a fresh job may still be starting');
  await sql`UPDATE jobs SET created_at=now()-interval '11 minutes' WHERE id=${fresh.id}`;
  assert.equal(await B.refundStuckJob(sql, fresh.id), true);
  assert.equal(await B.refundStuckJob(sql, fresh.id), false);

  await B.debitAndCreateJob(sql, started);
  await sql`UPDATE jobs SET created_at=now()-interval '1 hour', runway_id='task_1', status='PENDING' WHERE id=${started.id}`;
  assert.equal(await B.refundStuckJob(sql, started.id), false, 'job with a provider task is not stuck');
  assert.equal(await credits(u), 15);
});

test('debitForSwap records the charge on the project atomically', async () => {
  const u = await user(10), p = await project(u);
  assert.equal(await B.debitForSwap(sql, { projectId: p, userId: u, cost: 8 }), 2);
  assert.equal((await sql`SELECT credits_charged FROM swap_projects WHERE id=${p}`)[0].credits_charged, 8);
});

test('debitForSwap refuses unaffordable, unclaimed or foreign projects', async () => {
  const u = await user(10), other = await user(10), p = await project(u);
  assert.equal(await B.debitForSwap(sql, { projectId: p, userId: u, cost: 50 }), null);
  assert.equal(await B.debitForSwap(sql, { projectId: p, userId: other, cost: 1 }), null);
  const ready = await project(u, 'READY');
  assert.equal(await B.debitForSwap(sql, { projectId: ready, userId: u, cost: 1 }), null);
  assert.equal(await credits(u), 10);
  assert.equal(await credits(other), 10);
  assert.equal((await sql`SELECT credits_charged FROM swap_projects WHERE id=${p}`)[0].credits_charged, 0);
});

test('releaseSwapCharge refunds once and reopens the project', async () => {
  const u = await user(10), p = await project(u);
  await B.debitForSwap(sql, { projectId: p, userId: u, cost: 8 });
  await B.releaseSwapCharge(sql, { projectId: p, userId: u, cost: 8 });
  await B.releaseSwapCharge(sql, { projectId: p, userId: u, cost: 8 });
  assert.equal(await credits(u), 10);
  const row = (await sql`SELECT status,credits_charged FROM swap_projects WHERE id=${p}`)[0];
  assert.deepEqual([row.status, row.credits_charged], ['READY', 0]);
});

test('failAndRefundSwap refunds once and blocks a later release', async () => {
  const u = await user(10), p = await project(u);
  await B.debitForSwap(sql, { projectId: p, userId: u, cost: 6 });
  await B.failAndRefundSwap(sql, p, 'Video replacement failed');
  await B.failAndRefundSwap(sql, p, 'Video replacement failed');
  await B.releaseSwapCharge(sql, { projectId: p, userId: u, cost: 6 });
  assert.equal(await credits(u), 10);
});

test('failAndRefundSwap on an uncharged analysis refunds nothing', async () => {
  const u = await user(10), p = await project(u, 'ANALYZING');
  await B.failAndRefundSwap(sql, p, 'x');
  assert.equal(await credits(u), 10);
  assert.equal((await sql`SELECT status FROM swap_projects WHERE id=${p}`)[0].status, 'FAILED');
});
