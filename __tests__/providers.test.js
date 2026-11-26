// The provider layer: which provider runs a job, what each one sends, and how
// their status replies are normalized. fetch is mocked; nothing leaves the box.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROVIDER, cleanupTask, getProvider, modeAvailable, normalizeState, pollTask, providerFor, startTask }
  from '../lib/providers/index.js';
import { omniEnabledFor } from '../lib/providers/omni.js';

const TASK = '0f8c2a6e-3b1d-4c55-9a7e-2d4f6b8a1c3e';
const IMG = 'https://r2.example/u/a.jpg', VID = 'https://r2.example/u/m.mp4';
let calls;

// Replies to every fetch with `reply` (status 200 unless given) and records the request.
function mockFetch(t, reply, status = 200) {
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    return new Response(JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } });
  });
}
const sent = () => JSON.parse(calls[0].body);

beforeEach(() => {
  calls = [];
  process.env.RUNWAY_API_KEY = 'test-runway';
  process.env.VIGGLE_API_KEY = 'test-viggle';
  process.env.GEMINI_API_KEY = 'test-gemini';
});

test('providerFor uses VIDEO_PROVIDER only for modes that provider supports', () => {
  assert.equal(DEFAULT_PROVIDER, 'runway');
  assert.equal(providerFor('act', { VIDEO_PROVIDER: 'viggle' }), 'viggle');
  assert.equal(providerFor('image', { VIDEO_PROVIDER: 'viggle' }), 'runway');
  assert.equal(providerFor('video', { VIDEO_PROVIDER: 'viggle' }), 'runway');
  for (const env of [{}, { VIDEO_PROVIDER: 'runway' }, { VIDEO_PROVIDER: 'nope' }, { VIDEO_PROVIDER: 'toString' }]) {
    assert.equal(providerFor('act', env), 'runway', JSON.stringify(env));
  }
});

test('getProvider rejects unknown names, including prototype keys', () => {
  assert.equal(getProvider('viggle').name, 'viggle');
  for (const name of ['nope', 'toString', '__proto__', undefined]) assert.throws(() => getProvider(name));
});

test('normalizeState maps terminal states and passes the rest through', () => {
  for (const s of ['FAILED', 'failed', 'CANCELED', 'cancelled']) assert.equal(normalizeState(s), 'FAILED');
  for (const s of ['SUCCEEDED', 'succeeded', 'ready']) assert.equal(normalizeState(s), 'SUCCEEDED');
  assert.equal(normalizeState('throttled'), 'THROTTLED');
  assert.equal(normalizeState(undefined), 'PENDING');
});

test('runway image job sends gen4_turbo with prompt and duration', async t => {
  mockFetch(t, { id: TASK });
  assert.equal(await startTask('runway', { mode: 'image', sourceUrl: IMG, prompt: 'Wave', seconds: 10 }), TASK);
  assert.equal(calls[0].url, 'https://api.dev.runwayml.com/v1/image_to_video');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-runway');
  assert.deepEqual(sent(), { model: 'gen4_turbo', promptImage: IMG, promptText: 'Wave', ratio: '720:1280', duration: 10 });
});

test('runway video and act jobs hit their own endpoints', async t => {
  mockFetch(t, { id: TASK });
  await startTask('runway', { mode: 'video', sourceUrl: VID, prompt: 'Snow', seconds: 4 });
  await startTask('runway', { mode: 'act', sourceUrl: IMG, performanceUrl: VID, prompt: '', seconds: 8 });
  assert.equal(calls[0].url, 'https://api.dev.runwayml.com/v1/video_to_video');
  assert.deepEqual(sent(), { model: 'aleph2', videoUri: VID, promptText: 'Snow' });
  assert.equal(calls[1].url, 'https://api.dev.runwayml.com/v1/character_performance');
  const act = JSON.parse(calls[1].body);
  assert.equal(act.model, 'act_two');
  assert.deepEqual([act.character.uri, act.reference.uri], [IMG, VID]);
});

test('runway refuses an act job without a motion video, before any request', async t => {
  mockFetch(t, { id: TASK });
  await assert.rejects(startTask('runway', { mode: 'act', sourceUrl: IMG }), e => e.status === 400);
  await assert.rejects(startTask('runway', { mode: 'bogus', sourceUrl: IMG }), e => e.status === 400);
  assert.equal(calls.length, 0);
});

test('startTask rejects a missing or malformed task ID', async t => {
  for (const reply of [{}, { id: '' }, { id: 42 }, { id: '../x' }]) {
    calls = [];
    mockFetch(t, reply);
    await assert.rejects(startTask('runway', { mode: 'image', sourceUrl: IMG, prompt: 'Wave', seconds: 5 }),
      /valid task ID/, JSON.stringify(reply));
    t.mock.restoreAll();
  }
});

test('runway poll reads status and the first output URL', async t => {
  mockFetch(t, { status: 'SUCCEEDED', output: ['https://cdn.runway/out.mp4'] });
  assert.deepEqual(await pollTask('runway', TASK), { state: 'SUCCEEDED', videoUrl: 'https://cdn.runway/out.mp4', videoBytes: null });
  assert.equal(calls[0].url, `https://api.dev.runwayml.com/v1/tasks/${TASK}`);
});

test('pollTask hides non-HTTPS or missing video URLs', async t => {
  mockFetch(t, { status: 'SUCCEEDED', output: ['http://insecure/out.mp4'] });
  assert.deepEqual(await pollTask('runway', TASK), { state: 'SUCCEEDED', videoUrl: null, videoBytes: null });
  t.mock.restoreAll();
  mockFetch(t, { status: 'RUNNING' });
  assert.deepEqual(await pollTask('runway', TASK), { state: 'RUNNING', videoUrl: null, videoBytes: null });
});

test('pollTask refuses a malformed stored task ID without a request', async t => {
  mockFetch(t, {});
  for (const id of ['', '../../admin', 'a b', null]) await assert.rejects(pollTask('runway', id), /Invalid runway task ID/);
  assert.equal(calls.length, 0);
});

test('a busy provider surfaces as a transient error the status route can retry', async t => {
  mockFetch(t, { error: 'slow down' }, 429);
  await assert.rejects(pollTask('runway', TASK), e => e.transient === true && e.status === 503);
});

test('viggle starts a render with a form and polls video_url', async t => {
  mockFetch(t, { id: 'render_123' });
  assert.equal(await startTask('viggle', { mode: 'act', sourceUrl: IMG, performanceUrl: VID, prompt: '', seconds: 8 }), 'render_123');
  assert.equal(calls[0].url, 'https://apis.viggle.ai/v1/renders');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-viggle');
  assert.deepEqual([calls[0].body.get('image_url'), calls[0].body.get('motion_video_url')], [IMG, VID]);
  t.mock.restoreAll();

  mockFetch(t, { status: 'ready', video_url: 'https://cdn.viggle/out.mp4' });
  assert.deepEqual(await pollTask('viggle', 'render_123'), { state: 'SUCCEEDED', videoUrl: 'https://cdn.viggle/out.mp4', videoBytes: null });
  assert.equal(calls[1].url, 'https://apis.viggle.ai/v1/videos/render_123');
});

test('viggle refuses non-HTTPS media before any request', async t => {
  mockFetch(t, { id: 'render_123' });
  await assert.rejects(startTask('viggle', { mode: 'act', sourceUrl: 'http://x/a.jpg', performanceUrl: VID }), /HTTPS/);
  assert.equal(calls.length, 0);
});

// --- Gemini Omni (hd) -------------------------------------------------------
const OMNI_ID = 'v1_ChdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const PHOTO = Buffer.from('fake-jpeg-bytes');
const MP4 = Buffer.from('fake-mp4-bytes');

// The photo comes from R2 (IMG); every other request goes to Gemini and gets `reply`.
function mockOmni(t, reply, { status = 200, photoType = 'image/jpeg' } = {}) {
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    if (String(url) === IMG) return new Response(PHOTO, { headers: { 'Content-Type': photoType } });
    return new Response(JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } });
  });
}
const completed = parts => ({ id: OMNI_ID, status: 'completed', steps: [
  { type: 'user_input', content: [{ type: 'image', data: PHOTO.toString('base64'), mime_type: 'image/jpeg' }] },
  { type: 'thought', signature: 'abc' },
  { type: 'model_output', content: parts },
] });

test('hd always runs on omni, whatever VIDEO_PROVIDER says', () => {
  for (const env of [{}, { VIDEO_PROVIDER: 'viggle' }, { VIDEO_PROVIDER: 'runway' }]) assert.equal(providerFor('hd', env), 'omni');
  assert.throws(() => providerFor('bogus', {}), /No video provider/);
});

test('OMNI_ENABLED gates hd: off by default, a user list, or all; never without a key', () => {
  const key = { GEMINI_API_KEY: 'k' };
  assert.equal(omniEnabledFor('42', key), false);
  assert.equal(omniEnabledFor('42', { ...key, OMNI_ENABLED: ' 7, 42 ' }), true);
  assert.equal(omniEnabledFor(42, { ...key, OMNI_ENABLED: '7,42' }), true);
  assert.equal(omniEnabledFor('4', { ...key, OMNI_ENABLED: '7,42' }), false);
  assert.equal(omniEnabledFor('1', { ...key, OMNI_ENABLED: 'all' }), true);
  assert.equal(omniEnabledFor('1', { OMNI_ENABLED: 'all' }), false);
  assert.equal(modeAvailable('hd', '42', { ...key, OMNI_ENABLED: '42' }), true);
  assert.equal(modeAvailable('hd', '43', { ...key, OMNI_ENABLED: '42' }), false);
  for (const mode of ['image', 'video', 'act']) assert.equal(modeAvailable(mode, '43', {}), true, mode);
  assert.equal(modeAvailable('bogus', '43', {}), false);
});

test('omni start sends the photo inline with 9:16 720p background generation', async t => {
  mockOmni(t, { id: OMNI_ID, status: 'in_progress', object: 'interaction' });
  assert.equal(await startTask('omni', { mode: 'hd', sourceUrl: IMG, prompt: 'Smile', seconds: 10 }), OMNI_ID);
  assert.equal(calls[0].url, IMG);
  assert.equal(calls[1].url, GEMINI);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers['x-goog-api-key'], 'test-gemini');
  assert.ok(!calls[1].url.includes('key='), 'key must not be in the URL');
  assert.deepEqual(JSON.parse(calls[1].body), {
    model: 'gemini-omni-1.2-flash',
    input: [{ type: 'image', data: PHOTO.toString('base64'), mime_type: 'image/jpeg' }, { type: 'text', text: 'Smile' }],
    response_format: { type: 'video', aspect_ratio: '9:16', duration: '10s', resolution: '720p' },
    background: true,
  });
});

test('omni start refuses a source that is not a photo, before calling Gemini', async t => {
  mockOmni(t, { id: OMNI_ID }, { photoType: 'text/html' });
  await assert.rejects(startTask('omni', { mode: 'hd', sourceUrl: IMG, prompt: 'Smile', seconds: 5 }), /photo type/);
  assert.equal(calls.length, 1);
});

test('omni start passes on Gemini rejections as 400 and overload as transient', async t => {
  mockOmni(t, { error: { message: 'Unsupported person' } }, { status: 400 });
  await assert.rejects(startTask('omni', { mode: 'hd', sourceUrl: IMG, prompt: 'Smile', seconds: 5 }), e => e.status === 400);
  t.mock.restoreAll(); calls = [];
  mockOmni(t, { error: 'busy' }, { status: 503 });
  await assert.rejects(startTask('omni', { mode: 'hd', sourceUrl: IMG, prompt: 'Smile', seconds: 5 }), e => e.transient === true);
});

test('omni poll: in_progress keeps waiting, completed returns the video bytes', async t => {
  mockOmni(t, { id: OMNI_ID, status: 'in_progress' });
  assert.deepEqual(await pollTask('omni', OMNI_ID), { state: 'RUNNING', videoUrl: null, videoBytes: null });
  assert.equal(calls[0].url, `${GEMINI}/${OMNI_ID}`);
  assert.equal(calls[0].method, 'GET');
  t.mock.restoreAll();

  mockOmni(t, completed([{ type: 'video', mime_type: 'video/mp4', data: MP4.toString('base64') }]));
  const done = await pollTask('omni', OMNI_ID);
  assert.equal(done.state, 'SUCCEEDED');
  assert.equal(done.videoUrl, null);
  assert.deepEqual(Buffer.from(done.videoBytes), MP4); // the output video, not the echoed input photo
});

test('omni poll fails (so the job refunds) on failed/cancelled or a completed reply without video', async t => {
  for (const reply of [{ status: 'failed' }, { status: 'cancelled' }, { status: 'requires_action' },
    completed([{ type: 'text', text: 'I cannot help with that.' }])]) {
    calls = [];
    mockOmni(t, reply);
    assert.equal((await pollTask('omni', OMNI_ID)).state, 'FAILED', JSON.stringify(reply).slice(0, 60));
    t.mock.restoreAll();
  }
});

test('cleanupTask deletes the omni interaction and never throws', async t => {
  mockOmni(t, {});
  await cleanupTask('omni', OMNI_ID);
  assert.equal(calls[0].url, `${GEMINI}/${OMNI_ID}`);
  assert.equal(calls[0].method, 'DELETE');
  t.mock.restoreAll(); calls = [];

  mockOmni(t, { error: 'gone' }, { status: 404 });
  await cleanupTask('omni', OMNI_ID); // logged, not thrown
  await cleanupTask('runway', TASK); // providers without cleanup are a no-op
  await cleanupTask('omni', '../x'); // malformed IDs never reach the network
  assert.equal(calls.length, 1);
});
