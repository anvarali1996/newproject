import { badRequest } from './errors.js';

export const PACKS = Object.freeze({
  starter: { label: 'Starter', credits: 10, stars: 100 },
  creator: { label: 'Creator', credits: 30, stars: 270 },
  pro: { label: 'Pro', credits: 75, stars: 600 },
});
// Credits per second of video; for text2img, credits per image.
export const RATE = Object.freeze({ image: 1, video: 6, act: 2, hd: 2, text2img: 1 });
// `seconds` is the video length, or for text2img the number of images (always 1).
export function priceFor(mode, seconds, rates = RATE) {
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || !RATE[mode]) throw badRequest('Invalid duration or mode');
  if ((mode === 'image' || mode === 'hd') && ![5, 10].includes(seconds)) throw badRequest('Image videos must be 5 or 10 seconds');
  if (mode === 'text2img' && seconds !== 1) throw badRequest('Images are created one at a time');
  if (mode === 'act' && (seconds < 3 || seconds > 30)) {
    throw badRequest('Me in Video supports videos from 3 to 30 seconds.');
  }
  if (mode === 'video' && (seconds < 2 || seconds > 10)) throw badRequest('Video edits must be 2–10 seconds');
  if (!Number.isInteger(rates[mode]) || rates[mode] <= 0) throw Error('Credit rate unavailable');
  return rates[mode] * seconds;
}
