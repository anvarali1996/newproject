import { badRequest } from './errors.js';

// Text to Image (mode text2img): shared by the page and /api/generate.
// The provider files map each aspect to the ratio their API expects.
export const IMAGE_ASPECTS = Object.freeze({
  portrait: { label: 'Portrait', ratio: '9:16' },
  square: { label: 'Square', ratio: '1:1' },
  landscape: { label: 'Landscape', ratio: '16:9' },
});
export const MAX_IMAGE_PROMPT = 1000; // Runway's promptText limit

// The user's own words are the whole prompt here, so they are only tidied and bounded.
export function imagePrompt(text) {
  if (typeof text !== 'string') throw badRequest('Describe the image you want');
  const prompt = text.replace(/\s+/g, ' ').trim();
  if (prompt.length < 4) throw badRequest('Describe the image in a few more words');
  if (prompt.length > MAX_IMAGE_PROMPT) throw badRequest(`Image descriptions are limited to ${MAX_IMAGE_PROMPT} characters`);
  return prompt;
}

export function imageAspect(aspect = 'portrait') {
  if (!Object.hasOwn(IMAGE_ASPECTS, aspect)) throw badRequest('Unsupported image shape');
  return aspect;
}
