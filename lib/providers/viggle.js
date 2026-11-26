import { providerError, providerUnreachable } from '../errors.js';

// Official Viggle JST-1 Mix / Remix API.
const API = 'https://apis.viggle.ai/v1';

async function request(path, { method = 'GET', body } = {}) {
  const key = process.env.VIGGLE_API_KEY;
  if (!key) throw new Error('Missing VIGGLE_API_KEY');

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}` },
      ...(body ? { body } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) { throw providerUnreachable('Viggle', error); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError('Viggle', response.status, data);
  return data;
}

export default {
  name: 'viggle',
  modes: new Set(['act']),

  // Prompt and seconds do not apply: Viggle follows the motion video.
  async start({ sourceUrl, performanceUrl }) {
    for (const url of [sourceUrl, performanceUrl]) {
      if (typeof url !== 'string' || new URL(url).protocol !== 'https:') {
        throw new Error('Viggle requires HTTPS media URLs');
      }
    }
    const form = new FormData();
    form.append('image_url', sourceUrl);
    form.append('motion_video_url', performanceUrl);
    form.append('background_mode', 'original');
    return (await request('/renders', { method: 'POST', body: form }))?.id;
  },

  async poll(taskId) {
    const video = await request(`/videos/${encodeURIComponent(taskId)}`);
    return { status: video?.status, videoUrl: video?.video_url };
  },
};
