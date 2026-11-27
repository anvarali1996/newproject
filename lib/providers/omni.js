import { deleteInteraction, hasGeminiKey, pollInteraction, startInteraction } from './gemini-api.js';

// Google Gemini Omni Flash through the Gemini API's Interactions endpoint.
// Checked live on 2026-11-27: background mode returns an ID right away, a 5s
// 720p clip took ~29s, and the finished video comes back inline as base64.
export const OMNI_MODEL = 'gemini-omni-1.2-flash';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // same cap as /api/upload
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Omni needs the photo inline, so fetch it from R2's signed URL first.
async function inlineImage(url) {
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' }); }
  catch (error) { throw new Error('Could not read the source photo from storage', { cause: error }); }
  if (!response.ok) throw new Error(`Source photo download: ${response.status}`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!IMAGE_TYPES.has(type)) throw new Error(`Unexpected source photo type: ${type || 'none'}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Source photo is empty or too large');
  return { type: 'image', data: bytes.toString('base64'), mime_type: type };
}

// Who may use HD mode: OMNI_ENABLED=all, or a comma-separated list of Telegram
// user IDs for a staged rollout. Unset (or no API key) means nobody.
export function omniEnabledFor(userId, env = process.env) {
  if (!hasGeminiKey(env)) return false;
  const setting = (env.OMNI_ENABLED || '').trim();
  if (setting === 'all') return true;
  return setting.split(',').map(s => s.trim()).filter(Boolean).includes(String(userId));
}

export default {
  name: 'omni',
  modes: new Set(['hd']),
  isEnabledFor: omniEnabledFor,

  async start({ sourceUrl, prompt, seconds }) {
    const image = await inlineImage(sourceUrl);
    return startInteraction({
      model: OMNI_MODEL,
      input: [image, { type: 'text', text: prompt }],
      response_format: { type: 'video', aspect_ratio: '9:16', duration: `${seconds}s`, resolution: '720p' },
    }, { timeoutMs: 30000 }); // carries the photo (<=14MB base64); with the 15s download it fits /api/generate's 60s
  },

  poll: taskId => pollInteraction(taskId, { kind: 'video', maxBytes: MAX_VIDEO_BYTES, label: 'omni' }),

  // Delete Google's copy (the user's photo and the video) once we have the result or it failed.
  cleanup: deleteInteraction,
};
