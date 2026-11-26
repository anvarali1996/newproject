import { providerError, providerUnreachable } from './errors.js';

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

export async function createViggleVideo(imageUrl, motionVideoUrl) {
    for (const url of [imageUrl, motionVideoUrl]) {
        if (typeof url !== 'string' || new URL(url).protocol !== 'https:') {
            throw new Error('Viggle requires HTTPS media URLs');
        }
    }
    const form = new FormData();
    form.append('image_url', imageUrl);
    form.append('motion_video_url', motionVideoUrl);
    form.append('background_mode', 'original');
    const render = await request('/renders', { method: 'POST', body: form });
    if (!render?.id) throw new Error('Viggle did not return a render ID');
    return render;
}

export async function getViggleVideo(renderId) {
    if (typeof renderId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(renderId)) {
        throw new Error('Invalid Viggle render ID');
    }
    return request(`/videos/${encodeURIComponent(renderId)}`);
}
