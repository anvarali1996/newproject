export const PACKS = Object.freeze({
  starter: { label: 'Starter', credits: 10, stars: 100 },
  creator: { label: 'Creator', credits: 30, stars: 270 },
  pro: { label: 'Pro', credits: 75, stars: 600 },
});
export const RATE = Object.freeze({ image: 1, video: 6, act: 2 });
export function priceFor(mode, seconds, rates = RATE) {
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || !RATE[mode]) throw Error('Invalid duration or mode');
  if (mode === 'image' && ![5, 10].includes(seconds)) throw Error('Image videos must be 5 or 10 seconds');
  if (mode === 'act' && (seconds < 3 || seconds > 30)) {
    throw Error('Me in Video supports videos from 3 to 30 seconds.');
  }
  if (mode === 'video' && (seconds < 2 || seconds > 10)) throw Error('Video edits must be 2–10 seconds');
  if (!Number.isInteger(rates[mode]) || rates[mode] <= 0) throw Error('Credit rate unavailable');
  return rates[mode] * seconds;
}
