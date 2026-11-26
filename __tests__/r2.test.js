// Signing is local (no network), so this checks the real presigned URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedUpload } from '../lib/r2.js';

const ENV = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKIDEXAMPLE', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bucket' };

function withR2Env(t) {
  const saved = Object.fromEntries(Object.keys(ENV).map(k => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('upload URLs are bound to the declared size and type', async t => {
  withR2Env(t);
  const url = new URL(await signedUpload('uploads/1/a.mp4', 'video/mp4', 1234567));
  const signed = url.searchParams.get('X-Amz-SignedHeaders').split(';');
  assert.ok(signed.includes('content-length'), signed.join(';'));
  assert.ok(signed.includes('content-type'), signed.join(';'));
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
});

test('upload URLs carry no empty-body checksum the real upload would fail', async t => {
  withR2Env(t);
  const url = new URL(await signedUpload('uploads/1/a.jpg', 'image/jpeg', 2048));
  const checksumParams = [...url.searchParams.keys()].filter(k => /checksum/i.test(k));
  assert.deepEqual(checksumParams, []);
});

test('different sizes produce different signatures', async t => {
  withR2Env(t);
  const sig = async size => new URL(await signedUpload('uploads/1/a.png', 'image/png', size)).searchParams.get('X-Amz-Signature');
  assert.notEqual(await sig(100), await sig(101));
});

test('signedUpload refuses unvalidated sizes and types', async t => {
  withR2Env(t);
  for (const [type, size] of [['video/mp4', 0], ['video/mp4', 50 * 1024 * 1024 + 1], ['image/png', 1.5],
    ['image/gif', 100], ['video/mp4', undefined]]) {
    await assert.rejects(signedUpload('uploads/1/a', type, size), `${type} ${size}`);
  }
});
