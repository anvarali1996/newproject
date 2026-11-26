// One shape for every video provider, so routes never branch on provider names
// and adding one means adding a file here, not editing generate and status.
//
// A provider is { name, modes, start(input), poll(taskId), cleanup?(taskId), isEnabledFor?(userId) }:
//   start({ mode, sourceUrl, performanceUrl, prompt, seconds }) -> task ID
//   poll(taskId) -> { status, videoUrl?, videoBytes? } in the provider's own words
//   cleanup(taskId) -> deletes whatever the provider keeps about the task
//   isEnabledFor(userId) -> whether this user may use the provider's modes
// startTask/pollTask below validate and normalize what providers return.
import runway from './runway.js';
import viggle from './viggle.js';
import omni from './omni.js';

const PROVIDERS = Object.freeze({ runway, viggle, omni });
export const DEFAULT_PROVIDER = 'runway';

const FAILED = new Set(['FAILED', 'CANCELED', 'CANCELLED']);
const SUCCEEDED = new Set(['SUCCEEDED', 'READY']);
const TASK_ID = /^[a-zA-Z0-9_-]{1,120}$/;

export function getProvider(name) {
  const provider = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
  if (!provider) throw new Error(`Unknown video provider: ${name}`);
  return provider;
}

// VIDEO_PROVIDER picks the provider for every mode it supports. Otherwise the
// default runs the mode, or, for a mode it cannot run (hd), the provider that can.
export function providerFor(mode, env = process.env) {
  const wanted = env.VIDEO_PROVIDER;
  if (wanted && Object.hasOwn(PROVIDERS, wanted) && PROVIDERS[wanted].modes.has(mode)) return wanted;
  if (PROVIDERS[DEFAULT_PROVIDER].modes.has(mode)) return DEFAULT_PROVIDER;
  const other = Object.values(PROVIDERS).find(p => p.modes.has(mode));
  if (!other) throw new Error(`No video provider supports mode: ${mode}`);
  return other.name;
}

// Whether this user may start jobs in this mode (staged rollouts live here).
export function modeAvailable(mode, userId, env = process.env) {
  let provider;
  try { provider = getProvider(providerFor(mode, env)); } catch { return false; }
  return provider.isEnabledFor ? provider.isEnabledFor(userId, env) : true;
}

// Terminal states become FAILED or SUCCEEDED; anything else (PENDING, RUNNING,
// THROTTLED...) passes through uppercased and the client keeps waiting.
export function normalizeState(status) {
  const state = String(status || 'PENDING').toUpperCase();
  if (FAILED.has(state)) return 'FAILED';
  if (SUCCEEDED.has(state)) return 'SUCCEEDED';
  return state;
}

export async function startTask(name, input) {
  const id = await getProvider(name).start(input);
  if (typeof id !== 'string' || !TASK_ID.test(id)) throw new Error(`${name} did not return a valid task ID`);
  return id;
}

// A finished video arrives either as an HTTPS link (videoUrl) or as the bytes
// themselves (videoBytes); both are null until the provider has one.
export async function pollTask(name, taskId) {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new Error(`Invalid ${name} task ID`);
  const result = await getProvider(name).poll(taskId);
  const url = result?.videoUrl;
  const bytes = result?.videoBytes;
  return {
    state: normalizeState(result?.status),
    videoUrl: typeof url === 'string' && url.startsWith('https://') ? url : null,
    videoBytes: bytes instanceof Uint8Array && bytes.length > 0 ? bytes : null,
  };
}

// Best effort: a failed cleanup is logged, never surfaced to the user.
export async function cleanupTask(name, taskId) {
  try {
    const provider = getProvider(name);
    if (!provider.cleanup || typeof taskId !== 'string' || !TASK_ID.test(taskId)) return;
    await provider.cleanup(taskId);
  } catch (error) {
    console.warn(`[${name}] cleanup failed:`, error?.message ?? error);
  }
}
