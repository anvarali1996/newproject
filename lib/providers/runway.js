import { badRequest, providerError, providerUnreachable } from '../errors.js';

const API = 'https://api.dev.runwayml.com/v1';

async function request(endpoint, method = 'GET', body) {
  if (!process.env.RUNWAY_API_KEY) throw new Error('Missing RUNWAY_API_KEY');
  let res;
  try {
    res = await fetch(`${API}${endpoint}`, {
      method, headers: {
        Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`, 'X-Runway-Version': '2024-11-06',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25000),
      cache: 'no-store'
    });
  } catch (error) { throw providerUnreachable('Runway', error); }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
  if (!res.ok) throw providerError('Runway', res.status, data);
  return data;
}

// Text to Image on gen4_image at the 720p tier (5 Runway credits, $0.05 per image).
// gen4_image_turbo is cheaper but needs reference images, so it cannot draw from text alone.
const IMAGE_RATIOS = Object.freeze({ portrait: '720:1280', square: '720:720', landscape: '1280:720' });

function body(mode, { sourceUrl, performanceUrl, prompt, seconds, aspect = 'portrait' }) {
  if (mode === 'text2img' && Object.hasOwn(IMAGE_RATIOS, aspect)) return ['/text_to_image', {
    model: 'gen4_image', promptText: prompt, ratio: IMAGE_RATIOS[aspect]
  }];
  if (mode === 'image') return ['/image_to_video', {
    model: 'gen4_turbo', promptImage: sourceUrl, promptText: prompt, ratio: '720:1280', duration: seconds
  }];
  if (mode === 'video') return ['/video_to_video', {
    model: 'aleph2', videoUri: sourceUrl, promptText: prompt
  }];
  if (mode === 'act' && performanceUrl) return ['/character_performance', {
    model: 'act_two',
    character: { type: 'image', uri: sourceUrl },
    reference: { type: 'video', uri: performanceUrl },
    bodyControl: true, expressionIntensity: 2, ratio: '720:1280'
  }];
  throw badRequest('Unsupported mode');
}

export default {
  name: 'runway',
  modes: new Set(['image', 'video', 'act', 'text2img']),

  async start(input) {
    const [endpoint, payload] = body(input.mode, input);
    return (await request(endpoint, 'POST', payload))?.id;
  },

  async poll(taskId) {
    const task = await request(`/tasks/${encodeURIComponent(taskId)}`);
    return { status: task?.status, outputUrl: task?.output?.[0] };
  },
};
