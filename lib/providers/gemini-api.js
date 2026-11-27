import { providerError, providerUnreachable } from '../errors.js';

// What every Gemini provider shares: the Interactions API in background mode.
// POST returns an interaction ID right away; GET reports in_progress until the
// output (video or image, inline as base64) is ready; DELETE removes Google's copy.
const API = 'https://generativelanguage.googleapis.com/v1beta';

export function hasGeminiKey(env = process.env) {
  return !!(env.GEMINI_API_KEY || '').trim();
}

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

export async function startInteraction(body, { timeoutMs = 25000 } = {}) {
  const created = await request('/interactions', { method: 'POST', body: { ...body, background: true }, timeoutMs });
  return created?.id;
}

// The first output part of this kind, e.g.
// steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data }] }]
// Only model_output steps count: user_input steps echo the photo we sent.
function outputPart(interaction, kind) {
  for (const step of interaction?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (part?.type === kind || String(part?.mime_type || '').startsWith(`${kind}/`)) return part;
    }
  }
  return null;
}

// -> { status: RUNNING | FAILED | SUCCEEDED, outputBytes? }
export async function pollInteraction(taskId, { kind, maxBytes, label }) {
  const interaction = await request(`/interactions/${encodeURIComponent(taskId)}`);
  const status = String(interaction?.status || '');
  if (status === 'in_progress') return { status: 'RUNNING' };
  if (status !== 'completed') {
    // failed, cancelled, requires_action (nothing for us to act on), or unknown.
    if (status) console.warn(`[${label}] interaction ended as ${status}`);
    return { status: status ? 'FAILED' : 'RUNNING' };
  }
  const part = outputPart(interaction, kind);
  // Completed without inline output means it was filtered or delivered some
  // other way; we cannot save it, so fail (and refund) instead of waiting forever.
  if (typeof part?.data !== 'string' || !part.data) {
    console.warn(`[${label}] completed without inline ${kind}`, JSON.stringify(interaction?.usage ?? {}));
    return { status: 'FAILED' };
  }
  const bytes = Buffer.from(part.data, 'base64');
  if (!bytes.length || bytes.length > maxBytes) return { status: 'FAILED' };
  return { status: 'SUCCEEDED', outputBytes: bytes };
}

// Background mode makes Google store the interaction (inputs and output).
export async function deleteInteraction(taskId) {
  await request(`/interactions/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}
