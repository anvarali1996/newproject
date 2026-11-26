// Pure helpers that decide prices, durations, prompts and referrals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, PACKS, RATE } from '../lib/pricing.js';
import { mp4Duration } from '../lib/mp4-duration.js';
import { buildPrompt, PRESETS } from '../lib/prompt-presets.js';
import { referrerFromVerifiedInitData, referralUrl } from '../lib/referral-utils.js';
import { costForSwap, cleanCast, isCastId } from '../lib/lovely.js';

const status400 = e => e.status === 400;

test('priceFor charges rate x seconds within each mode limit', () => {
  assert.equal(priceFor('image', 5), 5 * RATE.image);
  assert.equal(priceFor('video', 10), 10 * RATE.video);
  assert.equal(priceFor('act', 30), 30 * RATE.act);
  assert.equal(priceFor('image', 10, { image: 3 }), 30);
});

test('priceFor rejects bad durations and modes with 400', () => {
  for (const [mode, s] of [['image', 7], ['act', 2], ['act', 31], ['video', 1], ['video', 11],
    ['video', 2.5], ['video', NaN], ['bogus', 5]]) {
    assert.throws(() => priceFor(mode, s), status400, `${mode} ${s}`);
  }
});

test('priceFor refuses a missing or invalid DB rate instead of charging 0', () => {
  assert.throws(() => priceFor('image', 5, { image: 0 }), e => !e.status);
  assert.throws(() => priceFor('image', 5, {}), e => !e.status);
});

test('credit packs are positive integers and bigger packs are cheaper per credit', () => {
  const packs = Object.values(PACKS);
  for (const p of packs) assert.ok(Number.isInteger(p.credits) && p.credits > 0 && Number.isInteger(p.stars) && p.stars > 0);
  const perCredit = packs.map(p => p.stars / p.credits);
  assert.deepEqual([...perCredit].sort((a, b) => b - a), perCredit);
});

// Minimal ISO-BMFF builders for mp4Duration.
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
};
const mvhd0 = (timescale, duration) => {
  const b = Buffer.alloc(100); // version 0, flags, ctime, mtime, timescale, duration, ...
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box('mvhd', b);
};
const mvhd1 = (timescale, duration) => {
  const b = Buffer.alloc(112);
  b[0] = 1;
  b.writeUInt32BE(timescale, 20);
  b.writeBigUInt64BE(BigInt(duration), 24);
  return box('mvhd', b);
};
const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isom'));

test('mp4Duration reads mvhd version 0 and 1', () => {
  assert.equal(mp4Duration(Buffer.concat([ftyp, box('moov', mvhd0(1000, 4500))])), 4.5);
  assert.equal(mp4Duration(Buffer.concat([ftyp, box('moov', mvhd1(600, 6000))])), 10);
});

test('mp4Duration finds moov after mdat', () => {
  const mdat = box('mdat', Buffer.alloc(4096, 7));
  assert.equal(mp4Duration(Buffer.concat([ftyp, mdat, box('moov', mvhd0(30, 90))])), 3);
});

test('mp4Duration rejects garbage, truncated and zero-length files with 400', () => {
  const full = Buffer.concat([ftyp, box('moov', mvhd0(1000, 4500))]);
  for (const bad of [Buffer.from('not a video at all'), Buffer.alloc(0), full.subarray(0, full.length - 60),
    Buffer.concat([ftyp, box('moov', mvhd0(0, 100))]), Buffer.concat([ftyp, box('moov', mvhd0(1000, 0))])]) {
    assert.throws(() => mp4Duration(bad), status400);
  }
});

test('buildPrompt uses server presets and cleans the extra instruction', () => {
  const p = buildPrompt('image', 'cinematic', '  slow   zoom \n in ');
  assert.ok(p.includes(PRESETS.image.find(x => x.id === 'cinematic').instruction));
  assert.ok(p.endsWith('slow zoom in'));
  assert.equal(buildPrompt('act', 'anything'), '');
  assert.ok(buildPrompt('video', 'neon', 'x'.repeat(300)).length <= 1000);
});

test('buildPrompt rejects unknown presets and oversized extras with 400', () => {
  assert.throws(() => buildPrompt('image', 'neon'), status400); // neon is a video preset
  assert.throws(() => buildPrompt('image', 'natural', 'x'.repeat(301)), status400);
  assert.throws(() => buildPrompt('image', 'natural', { evil: true }), status400);
});

test('referrerFromVerifiedInitData accepts only ref_<id> from someone else', () => {
  assert.equal(referrerFromVerifiedInitData('start_param=ref_42&hash=x', 7), '42');
  assert.equal(referrerFromVerifiedInitData('start_param=ref_7', 7), null, 'self-referral');
  for (const v of ['ref_0', 'ref_01', 'ref_abc', 'ref_42;drop', 'ref_12345678901234567', 'promo_42', '']) {
    assert.equal(referrerFromVerifiedInitData(`start_param=${encodeURIComponent(v)}`, 7), null, v);
  }
  assert.equal(referrerFromVerifiedInitData(undefined, 7), null);
});

test('referralUrl builds a Mini App link only from valid bot settings', t => {
  const saved = { bot: process.env.TELEGRAM_BOT_USERNAME, app: process.env.TELEGRAM_APP_SHORT_NAME };
  t.after(() => {
    for (const [k, v] of [['TELEGRAM_BOT_USERNAME', saved.bot], ['TELEGRAM_APP_SHORT_NAME', saved.app]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  process.env.TELEGRAM_BOT_USERNAME = '@vision_bot';
  process.env.TELEGRAM_APP_SHORT_NAME = 'studio';
  assert.equal(referralUrl(42), 'https://t.me/vision_bot/studio?startapp=ref_42');
  process.env.TELEGRAM_BOT_USERNAME = 'bad name/../x';
  assert.equal(referralUrl(42), '');
});

test('swap helpers: cost rounds seconds up, cast is sanitized', () => {
  assert.equal(costForSwap(2.1, 12), 36);
  assert.throws(() => costForSwap(1.9, 12), status400);
  assert.throws(() => costForSwap(10.5, 12), status400);
  assert.ok(isCastId('p1') && isCastId('p12'));
  assert.ok(!isCastId('p0') && !isCastId('x1') && !isCastId(1));
  const cast = cleanCast([{ id: 'p1', seconds: 3 }, null, { id: 'evil' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }]);
  assert.deepEqual(cast, [{ id: 'p1', seconds: 3 }, { id: 'p2', seconds: 0 }, { id: 'p3', seconds: 0 }, { id: 'p4', seconds: 0 }]);
  assert.deepEqual(cleanCast('nope'), []);
});
