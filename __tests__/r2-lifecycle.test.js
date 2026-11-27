import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLifecycle, visionaiRules, mergeRules, UPLOAD_RULE_ID, MULTIPART_RULE_ID } from '../lib/r2-lifecycle.js';

// Fake S3 client: records commands, serves a stored lifecycle config.
function fakeS3({ rules = null, getError = null, putError = null } = {}) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      if (name === 'GetBucketLifecycleConfigurationCommand') {
        if (getError) throw getError;
        if (!rules) throw Object.assign(new Error('none'), { name: 'NoSuchLifecycleConfiguration' });
        return { Rules: rules };
      }
      if (putError) throw putError;
      rules = cmd.input.LifecycleConfiguration.Rules;
      return {};
    },
  };
}
const puts = s3 => s3.calls.filter(c => c.name === 'PutBucketLifecycleConfigurationCommand');

test('expires only uploads/, never results/', () => {
  const [uploads, multipart] = visionaiRules(7);
  assert.deepEqual(uploads.Filter, { Prefix: 'uploads/' });
  assert.equal(uploads.Expiration.Days, 7);
  assert.equal(multipart.Expiration, undefined, 'the bucket-wide rule must not delete objects');
  assert.equal(multipart.AbortIncompleteMultipartUpload.DaysAfterInitiation, 1);
});

test('dry run reads but never writes', async () => {
  const s3 = fakeS3();
  const { changed, after } = await syncLifecycle(s3, 'b');
  assert.equal(changed, true);
  assert.deepEqual(after.map(r => r.ID), [UPLOAD_RULE_ID, MULTIPART_RULE_ID]);
  assert.equal(puts(s3).length, 0);
});

test('apply keeps rules it does not own and replaces its own by ID', async () => {
  const foreign = { ID: 'Default Multipart Abort Rule', Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } };
  const s3 = fakeS3({ rules: [foreign, ...visionaiRules(30)] });
  await syncLifecycle(s3, 'b', { uploadDays: 7, apply: true });
  const written = puts(s3)[0].input.LifecycleConfiguration.Rules;
  assert.deepEqual(written.map(r => r.ID), [foreign.ID, UPLOAD_RULE_ID, MULTIPART_RULE_ID]);
  assert.equal(written.find(r => r.ID === UPLOAD_RULE_ID).Expiration.Days, 7);
});

test('apply is a no-op when the rules are already in place', async () => {
  const s3 = fakeS3({ rules: visionaiRules(7) });
  const { changed } = await syncLifecycle(s3, 'b', { uploadDays: 7, apply: true });
  assert.equal(changed, false);
  assert.equal(puts(s3).length, 0);
});

test('a token without bucket admin rights gets an actionable error', async () => {
  const denied = Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  await assert.rejects(syncLifecycle(fakeS3({ getError: denied }), 'b'), /Admin Read & Write/);
  await assert.rejects(syncLifecycle(fakeS3({ putError: denied }), 'b', { apply: true }), /Admin Read & Write/);
});

test('rejects nonsense retention', () => {
  for (const d of [0, -1, 1.5, 366, NaN]) assert.throws(() => visionaiRules(d), String(d));
  assert.deepEqual(mergeRules(undefined, []), []);
});
