// Signing is local (no network), so this checks the real presigned URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { downloadResult, imageKind, saveResultBytes, signedUpload } from '../lib/r2.js';

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

test('saveResultBytes stores provider bytes as an mp4 and refuses empty results', async t => {
  withR2Env(t);
  const sent = [];
  t.mock.method(S3Client.prototype, 'send', async command => { sent.push(command.input); return {}; });
  await saveResultBytes(new Uint8Array([1, 2, 3]), 'results/1/j.mp4');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].Key, 'results/1/j.mp4');
  assert.equal(sent[0].ContentType, 'video/mp4');
  assert.equal(sent[0].ContentLength, 3);
  await assert.rejects(saveResultBytes(new Uint8Array(), 'results/1/j.mp4'), /Empty/);
  await assert.rejects(saveResultBytes('not bytes', 'results/1/j.mp4'), /Empty/);
  await saveResultBytes(new Uint8Array([1, 2, 3]), 'results/1/j.png', 'image/png');
  assert.equal(sent[1].ContentType, 'image/png');
  await assert.rejects(saveResultBytes(new Uint8Array([1]), 'results/1/j.html', 'text/html'), /Unsupported/);
  assert.equal(sent.length, 2);
});

test('imageKind trusts only the file signature', () => {
  const pad = Buffer.alloc(16);
  assert.deepEqual(imageKind(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])), { type: 'image/png', ext: 'png' });
  assert.deepEqual(imageKind(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(imageKind(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), pad])), { type: 'image/webp', ext: 'webp' });
  for (const bad of [Buffer.from('<html><body>nope</body></html>'), Buffer.from([0x89, 0x50]), new Uint8Array(), 'PNG']) {
    assert.equal(imageKind(bad), null);
  }
});

test('downloadResult refuses non-HTTPS links and oversized files', async t => {
  await assert.rejects(downloadResult('http://cdn.example/a.png', 100), /Invalid/);
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.alloc(200)));
  await assert.rejects(downloadResult('https://cdn.example/a.png', 100), /too large/);
  assert.equal((await downloadResult('https://cdn.example/a.png', 500)).length, 200);
});
