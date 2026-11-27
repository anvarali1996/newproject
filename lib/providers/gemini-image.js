import { badRequest } from '../errors.js';
import { deleteInteraction, hasGeminiKey, pollInteraction, startInteraction } from './gemini-api.js';

// Text to Image on Google's Nano Banana 2.1 through the Interactions API.
// Docs (2026-11-27): recommended image model, $0.0336 per 1K image, 9:16 is 768x1376.
export const GEMINI_IMAGE_MODEL = 'gemini-nano-banana-2.1';
const RATIOS = Object.freeze({ portrait: '9:16', square: '1:1', landscape: '16:9' });
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export default {
  name: 'gemini',
  modes: new Set(['text2img']),
  // Needs nothing but the key: there is no staged rollout for images.
  isEnabledFor: (_userId, env = process.env) => hasGeminiKey(env),

  async start({ prompt, aspect = 'portrait' }) {
    if (!Object.hasOwn(RATIOS, aspect)) throw badRequest('Unsupported image shape');
    return startInteraction({
      model: GEMINI_IMAGE_MODEL,
      input: [{ type: 'text', text: prompt }],
      response_format: { type: 'image', aspect_ratio: RATIOS[aspect], image_size: '1K' },
    });
  },

  poll: taskId => pollInteraction(taskId, { kind: 'image', maxBytes: MAX_IMAGE_BYTES, label: 'gemini' }),

  cleanup: deleteInteraction,
};
