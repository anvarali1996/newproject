import { randomUUID } from 'node:crypto';
import { auth, jsonError } from '../../../lib/auth.js';
import { db, upsertUser } from '../../../lib/db.js';
import { verifySource, verifiedVideoSeconds } from '../../../lib/r2.js';
import { modeAvailable, providerFor, startTask } from '../../../lib/providers/index.js';
import { billedPrice } from '../../../lib/pricing-db.js';
import { buildPrompt } from '../../../lib/prompt-presets.js';
import { badRequest, forbidden, paymentRequired, readJson } from '../../../lib/errors.js';
import { debitAndCreateJob, failAndRefundJob } from '../../../lib/billing.js';
import { enforceRateLimit } from '../../../lib/rate-limit.js';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let jobId = null;
  try {
    const user = auth(req);
    const { mode, key, videoKey, presetId, extraPrompt, seconds: requestedSeconds } = await readJson(req);
    if (!['image', 'video', 'act', 'hd'].includes(mode)) throw badRequest('Unsupported mode');
    if (!modeAvailable(mode, user.id)) throw forbidden('This mode is not available yet');
    const provider = providerFor(mode);
    const prompt = mode === 'act' ? '' : buildPrompt(mode, presetId, extraPrompt || '');
    if (mode !== 'act' && (typeof prompt !== 'string' || prompt.trim().length < 4 || prompt.length > 1000)) throw badRequest('Invalid prompt');
    if (mode === 'act' && !videoKey) throw badRequest('Portrait and motion video are required');
    // After cheap validation, before the video download and the provider call.
    await enforceRateLimit(db(), 'generate', user.id);
    let sourceUrl, performanceUri = null, seconds;
    if (mode === 'image' || mode === 'hd') {
      seconds = Number(requestedSeconds);
      sourceUrl = await verifySource(key, user.id, 'image');
    } else if (mode === 'video') {
      seconds = await verifiedVideoSeconds(key, user.id);
      sourceUrl = await verifySource(key, user.id, 'video');
    } else {
      sourceUrl = await verifySource(key, user.id, 'image');
      seconds = await verifiedVideoSeconds(videoKey, user.id, { minSeconds: 3, maxSeconds: 30 });
      performanceUri = await verifySource(videoKey, user.id, 'video');
    }
    const cost = await billedPrice(mode, seconds);
    const sql = db();
    await upsertUser(user);
    const id = randomUUID();
    // Debit + job row in one statement: a failed insert can no longer eat credits.
    const remaining = await debitAndCreateJob(sql, {
      id, userId: user.id, sourceKey: key, secondaryKey: videoKey || null, mode,
      prompt: mode === 'act' ? 'Performance transfer' : prompt.trim(), seconds, cost, provider,
    });
    if (remaining === null) throw paymentRequired(`Not enough credits (need ${cost})`);
    jobId = id;
    const taskId = await startTask(provider, {
      mode, sourceUrl, performanceUrl: performanceUri, prompt: mode === 'act' ? '' : prompt.trim(), seconds,
    });
    // runway_id holds the task ID of whichever provider runs the job.
    await sql`UPDATE jobs SET runway_id=${taskId},status='PENDING' WHERE id=${jobId}`;
    return Response.json({ id: jobId, status: 'PENDING', remaining, cost, seconds });
  } catch (e) {
    // jobId is set only once the user has been charged for this job.
    if (jobId) {
      try { await failAndRefundJob(db(), jobId, 'Task could not start'); }
      catch (x) { console.error(`Refund for job ${jobId} needs investigation:`, x); }
    }
    return jsonError(e);
  }
}
