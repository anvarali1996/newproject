import { randomUUID } from 'node:crypto';
import { auth, jsonError } from '../../../lib/auth.js';
import { db, upsertUser } from '../../../lib/db.js';
import { verifySource, verifiedVideoSeconds } from '../../../lib/r2.js';
import { chooseProvider, startTask } from '../../../lib/providers/index.js';
import { billedPrice } from '../../../lib/pricing-db.js';
import { buildPrompt } from '../../../lib/prompt-presets.js';
import { imageAspect, imagePrompt } from '../../../lib/text-image.js';
import { badRequest, forbidden, paymentRequired, readJson } from '../../../lib/errors.js';
import { debitAndCreateJob, failAndRefundJob } from '../../../lib/billing.js';
import { enforceRateLimit } from '../../../lib/rate-limit.js';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MODES = ['image', 'video', 'act', 'hd', 'text2img'];

export async function POST(req) {
  let jobId = null;
  try {
    const user = auth(req);
    const body = await readJson(req);
    const { mode, key, videoKey, presetId, extraPrompt, seconds: requestedSeconds, engine } = body;
    if (!MODES.includes(mode)) throw badRequest('Unsupported mode');
    if (engine != null && typeof engine !== 'string') throw badRequest('Invalid AI engine');
    const provider = chooseProvider(mode, user.id, engine);
    if (!provider) throw forbidden(engine ? 'This AI engine is not available' : 'This mode is not available yet');
    const textImage = mode === 'text2img';
    // text2img: the user's own description; other modes: a preset plus an optional extra line.
    const prompt = textImage ? imagePrompt(body.prompt) : mode === 'act' ? '' : buildPrompt(mode, presetId, extraPrompt || '');
    const aspect = textImage ? imageAspect(body.aspect ?? 'portrait') : undefined;
    if (mode !== 'act' && (typeof prompt !== 'string' || prompt.trim().length < 4 || prompt.length > 1000)) throw badRequest('Invalid prompt');
    if (mode === 'act' && !videoKey) throw badRequest('Portrait and motion video are required');
    // After cheap validation, before the video download and the provider call.
    await enforceRateLimit(db(), 'generate', user.id);
    let sourceUrl = null, performanceUri = null, seconds = null;
    if (textImage) {
      // Nothing to upload or verify: the prompt is the whole input.
    } else if (mode === 'image' || mode === 'hd') {
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
    // Images are priced per image (one per job); videos per second.
    const cost = await billedPrice(mode, textImage ? 1 : seconds);
    const sql = db();
    await upsertUser(user);
    const id = randomUUID();
    // Debit + job row in one statement: a failed insert can no longer eat credits.
    const remaining = await debitAndCreateJob(sql, {
      id, userId: user.id, sourceKey: textImage ? null : key, secondaryKey: videoKey || null, mode,
      prompt: mode === 'act' ? 'Performance transfer' : prompt.trim(), seconds, cost, provider,
    });
    if (remaining === null) throw paymentRequired(`Not enough credits (need ${cost})`);
    jobId = id;
    const taskId = await startTask(provider, {
      mode, sourceUrl, performanceUrl: performanceUri, prompt: mode === 'act' ? '' : prompt.trim(), seconds, aspect,
    });
    // runway_id holds the task ID of whichever provider runs the job.
    await sql`UPDATE jobs SET runway_id=${taskId},status='PENDING' WHERE id=${jobId}`;
    return Response.json({ id: jobId, status: 'PENDING', remaining, cost, seconds, provider });
  } catch (e) {
    // jobId is set only once the user has been charged for this job.
    if (jobId) {
      try { await failAndRefundJob(db(), jobId, 'Task could not start'); }
      catch (x) { console.error(`Refund for job ${jobId} needs investigation:`, x); }
    }
    return jsonError(e);
  }
}
