import { providerError, providerUnreachable } from '../errors.js';

// Google Gemini Omni Flash through the Gemini API's Interactions endpoint.
// Checked live on 2026-11-27: background mode returns an ID right away, a 5s
// 720p clip took ~29s, and the finished video comes back inline as base64.
const API = 'https://generativelanguage.googleapis.com/v1beta';
export const OMNI_MODEL = 'gemini-omni-1.2-flash';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // same cap as /api/upload
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function apiKey() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
}

async function request(path, { method = 'GET', body, timeoutMs = 25000 } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      // Header, not ?key=, so the key never lands in URL logs.
      headers: { 'x-goog-api-key': apiKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) { throw providerUnreachable('Gemini', error); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError('Gemini', response.status, data);
  return data;
}

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

// The first video part of the model's output, e.g.
// steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data }] }]
function outputVideo(interaction) {
  for (const step of interaction?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (part?.type === 'video' || String(part?.mime_type || '').startsWith('video/')) return part;
    }
  }
  return null;
}

// Who may use HD mode: OMNI_ENABLED=all, or a comma-separated list of Telegram
// user IDs for a staged rollout. Unset (or no API key) means nobody.
export function omniEnabledFor(userId, env = process.env) {
  if (!(env.GEMINI_API_KEY || '').trim()) return false;
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
    const created = await request('/interactions', {
      method: 'POST',
      timeoutMs: 30000, // carries the photo (<=14MB base64); with the 15s download it fits /api/generate's 60s
      body: {
        model: OMNI_MODEL,
        input: [image, { type: 'text', text: prompt }],
        response_format: { type: 'video', aspect_ratio: '9:16', duration: `${seconds}s`, resolution: '720p' },
        background: true,
      },
    });
    return created?.id;
  },

  async poll(taskId) {
    const interaction = await request(`/interactions/${encodeURIComponent(taskId)}`);
    const status = String(interaction?.status || '');
    if (status === 'in_progress') return { status: 'RUNNING' };
    if (status !== 'completed') {
      // failed, cancelled, requires_action (nothing for us to act on), or unknown.
      if (status) console.warn(`[omni] interaction ended as ${status}`);
      return { status: status ? 'FAILED' : 'RUNNING' };
    }
    const video = outputVideo(interaction);
    // Completed without an inline video means it was filtered or delivered some
    // other way; we cannot save it, so fail (and refund) instead of waiting forever.
    if (typeof video?.data !== 'string' || !video.data) {
      console.warn('[omni] completed without inline video', JSON.stringify(interaction?.usage ?? {}));
      return { status: 'FAILED' };
    }
    const bytes = Buffer.from(video.data, 'base64');
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) return { status: 'FAILED' };
    return { status: 'SUCCEEDED', videoBytes: bytes };
  },

  // Background mode makes Google store the interaction (the user's photo and
  // the video). Delete it once we have the result or it has failed.
  async cleanup(taskId) {
    await request(`/interactions/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  },
};
