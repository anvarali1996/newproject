// Expires old source uploads in R2 (finished videos in results/ are kept).
// Dry run (shows the change):  node --env-file=.env.local scripts/set-r2-lifecycle.mjs
// Apply:                       node --env-file=.env.local scripts/set-r2-lifecycle.mjs --apply
// Other retention:             ... --days 14 --apply
// Needs an R2 token with "Admin Read & Write"; the app's object token cannot change bucket settings.
import { client } from '../lib/r2.js';
import { syncLifecycle, DEFAULT_UPLOAD_DAYS } from '../lib/r2-lifecycle.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const daysAt = args.indexOf('--days');
const uploadDays = daysAt === -1 ? DEFAULT_UPLOAD_DAYS : Number(args[daysAt + 1]);
const unknown = args.filter((a, i) => a !== '--apply' && a !== '--days' && i !== daysAt + 1);
if (unknown.length || (daysAt !== -1 && !args[daysAt + 1])) {
  console.error('Usage: scripts/set-r2-lifecycle.mjs [--days N] [--apply]');
  process.exit(2);
}

const bucket = process.env.R2_BUCKET;
const { before, after, changed } = await syncLifecycle(client(), bucket, { uploadDays, apply });
const show = rules => rules.length ? rules.map(r => `  - ${r.ID} (${r.Status}) ${JSON.stringify({ ...r, ID: undefined, Status: undefined })}`).join('\n') : '  (none)';
console.log(`Bucket ${bucket}\nCurrent rules:\n${show(before)}\n${changed ? 'New rules:' : 'Already up to date:'}\n${show(after)}`);
if (!changed) process.exit(0);
console.log(apply
  ? `\nApplied. R2 deletes uploads/ objects older than ${uploadDays} days (usually within 24h of expiry).`
  : '\nDry run: nothing was changed. Re-run with --apply to write these rules.');
