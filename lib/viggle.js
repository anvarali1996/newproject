// const API = 'https://...';

// export async function createViggleTask({ imageUrl, videoUrl }) {
//     if (!process.env.VIGGLE_API_KEY) throw new Error('Missing RUNWAY_API_KEY');
//     const res = await fetch(`${API}${endpoint}`, {
//         method, headers: {
//             Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`, 'X-Runway-Version': '2024-11-06',
//             ...(body ? { 'Content-Type': 'application/json' } : {})
//         },
//         ...(body ? { body: JSON.stringify(body) } : {}),
//         signal: AbortSignal.timeout(25000),
//         cache: 'no-store'
//     });
//     const text = await res.text();
//     let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
//     if (!res.ok) throw new Error(`Runway ${res.status}: ${JSON.stringify(data).slice(0, 350)}`);
//     return data;
// }

// export async function getViggleTask(taskId) {
//     if (mode === 'image') return runway('/image_to_video', 'POST', {
//         model: 'gen4_turbo', promptImage: sourceUri, promptText: prompt, ratio: '720:1280', duration: seconds
//     });
//     if (mode === 'video') return runway('/video_to_video', 'POST', {
//         model: 'aleph2', videoUri: sourceUri, promptText: prompt
//     });
//     if (mode === 'act' && performanceUri) return runway('/character_performance', 'POST', {
//         model: 'act_two',
//         character: { type: 'image', uri: sourceUri },
//         reference: { type: 'video', uri: performanceUri },
//         bodyControl: true, expressionIntensity: 2, ratio: '720:1280'
//     });
//     throw new Error('Unsupported mode');
// }


// Official Viggle JST-1 Mix / Remix API.
const API = 'https://apis.viggle.ai/v1';

async function request(path, { method = 'GET', body } = {}) {
    const key = process.env.VIGGLE_API_KEY;
    if (!key) throw new Error('Missing VIGGLE_API_KEY');

    const response = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}` },
        ...(body ? { body } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(25000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 250);
        throw new Error(`Viggle ${response.status}: ${detail}`);
    }
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
