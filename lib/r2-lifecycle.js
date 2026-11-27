import { GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';

// What the app stores in R2, and how long it is needed:
// - uploads/<user>/...  Source photos and videos. Read only when a generation or
//   swap starts (verifySource signs a 4h link for the provider). Safe to expire.
// - results/<user>/...  Finished videos. The status routes re-sign them every
//   time a user opens a result, so they are NOT expired here.
export const UPLOAD_RULE_ID = 'visionai-expire-uploads';
export const MULTIPART_RULE_ID = 'visionai-abort-incomplete-multipart';
export const DEFAULT_UPLOAD_DAYS = 7;

export function visionaiRules(uploadDays = DEFAULT_UPLOAD_DAYS) {
  if (!Number.isInteger(uploadDays) || uploadDays < 1 || uploadDays > 365) {
    throw Error('Upload retention must be a whole number of days from 1 to 365');
  }
  return [
    { ID: UPLOAD_RULE_ID, Status: 'Enabled', Filter: { Prefix: 'uploads/' }, Expiration: { Days: uploadDays } },
    // saveResult streams results with multipart uploads; clean up any that died midway.
    { ID: MULTIPART_RULE_ID, Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
  ];
}

// PutBucketLifecycleConfiguration replaces ALL rules, so keep every rule that is
// not ours (e.g. R2's default multipart rule, or rules added in the dashboard)
// and replace ours by ID.
export function mergeRules(existing, ours) {
  const ids = new Set(ours.map(r => r.ID));
  return [...(existing || []).filter(r => !ids.has(r.ID)), ...ours];
}

async function currentRules(s3, bucket) {
  try {
    const res = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    return res.Rules || [];
  } catch (error) {
    if (error?.name === 'NoSuchLifecycleConfiguration' || error?.Code === 'NoSuchLifecycleConfiguration') return [];
    throw explain(error);
  }
}

function explain(error) {
  const status = error?.$metadata?.httpStatusCode;
  if (error?.name === 'AccessDenied' || status === 401 || status === 403) {
    return Error('R2 refused access to the bucket lifecycle settings. The app\'s "Object Read & Write" token cannot change them; '
      + 'use an R2 token with "Admin Read & Write" (only for this script), or add the rule in the Cloudflare dashboard.', { cause: error });
  }
  return error;
}

// Returns { before, after, changed }. Writes only when apply is true.
export async function syncLifecycle(s3, bucket, { uploadDays = DEFAULT_UPLOAD_DAYS, apply = false } = {}) {
  const before = await currentRules(s3, bucket);
  const after = mergeRules(before, visionaiRules(uploadDays));
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (apply && changed) {
    try {
      await s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: { Rules: after } }));
    } catch (error) { throw explain(error); }
  }
  return { before, after, changed };
}
