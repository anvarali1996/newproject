// One shape for every provider, so routes never branch on provider names
// and adding one means adding a file here, not editing generate and status.
//
// A provider is { name, modes, start(input), poll(taskId), cleanup?(taskId), isEnabledFor?(userId) }:
//   start({ mode, sourceUrl, performanceUrl, prompt, seconds, aspect }) -> task ID
//   poll(taskId) -> { status, outputUrl?, outputBytes? } in the provider's own words
//   cleanup(taskId) -> deletes whatever the provider keeps about the task
//   isEnabledFor(userId) -> whether this user may use the provider's modes
// startTask/pollTask below validate and normalize what providers return.
import runway from './runway.js';
import viggle from './viggle.js';
import omni from './omni.js';
import gemini from './gemini-image.js';

const PROVIDERS = Object.freeze({ runway, viggle, omni, gemini });
export const DEFAULT_PROVIDER = 'runway';
// Modes where the user picks the engine (the page shows a choice for these).
export const CHOOSABLE_MODES = Object.freeze(new Set(['text2img']));

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

const enabledFor = (provider, userId, env) => (provider.isEnabledFor ? provider.isEnabledFor(userId, env) : true);

// The engines this user may choose from for a choosable mode, in display order.
export function enginesFor(mode, userId, env = process.env) {
  if (!CHOOSABLE_MODES.has(mode)) return [];
  return Object.values(PROVIDERS).filter(p => p.modes.has(mode) && enabledFor(p, userId, env)).map(p => p.name);
}

// The provider that runs this user's job, or null if they may not use the mode
// (staged rollouts) or the engine they asked for. Without an engine the usual
// providerFor choice applies; an engine is honoured only for choosable modes.
export function chooseProvider(mode, userId, engine, env = process.env) {
  if (engine == null || engine === '') {
    let name;
    try { name = providerFor(mode, env); } catch { return null; }
    return enabledFor(PROVIDERS[name], userId, env) ? name : null;
  }
  return enginesFor(mode, userId, env).includes(engine) ? engine : null;
}

// Whether this user may start jobs in this mode.
export function modeAvailable(mode, userId, env = process.env) {
  return chooseProvider(mode, userId, null, env) !== null;
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

// A finished video or image arrives either as an HTTPS link (outputUrl) or as
// the bytes themselves (outputBytes); both are null until the provider has one.
export async function pollTask(name, taskId) {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new Error(`Invalid ${name} task ID`);
  const result = await getProvider(name).poll(taskId);
  const url = result?.outputUrl;
  const bytes = result?.outputBytes;
  return {
    state: normalizeState(result?.status),
    outputUrl: typeof url === 'string' && url.startsWith('https://') ? url : null,
    outputBytes: bytes instanceof Uint8Array && bytes.length > 0 ? bytes : null,
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
