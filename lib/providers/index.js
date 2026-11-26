// One shape for every video provider, so routes never branch on provider names
// and adding one means adding a file here, not editing generate and status.
//
// A provider is { name, modes, start(input), poll(taskId) }:
//   start({ mode, sourceUrl, performanceUrl, prompt, seconds }) -> task ID
//   poll(taskId) -> { status, videoUrl } in the provider's own words
// startTask/pollTask below validate and normalize what providers return.
import runway from './runway.js';
import viggle from './viggle.js';

const PROVIDERS = Object.freeze({ runway, viggle });
export const DEFAULT_PROVIDER = 'runway';

const FAILED = new Set(['FAILED', 'CANCELED', 'CANCELLED']);
const SUCCEEDED = new Set(['SUCCEEDED', 'READY']);
const TASK_ID = /^[a-zA-Z0-9_-]{1,120}$/;

export function getProvider(name) {
  const provider = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
  if (!provider) throw new Error(`Unknown video provider: ${name}`);
  return provider;
}

// VIDEO_PROVIDER picks the provider for every mode it supports; other modes,
// and unknown values, use the default. Today that means viggle handles act only.
export function providerFor(mode, env = process.env) {
  const wanted = env.VIDEO_PROVIDER;
  if (wanted && Object.hasOwn(PROVIDERS, wanted) && PROVIDERS[wanted].modes.has(mode)) return wanted;
  return DEFAULT_PROVIDER;
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

// videoUrl is null until the provider exposes an HTTPS download link.
export async function pollTask(name, taskId) {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new Error(`Invalid ${name} task ID`);
  const result = await getProvider(name).poll(taskId);
  const url = result?.videoUrl;
  return {
    state: normalizeState(result?.status),
    videoUrl: typeof url === 'string' && url.startsWith('https://') ? url : null,
  };
}
