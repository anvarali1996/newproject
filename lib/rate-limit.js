import { tooManyRequests } from './errors.js';

// Counts one hit against `key` if it is under `limit` for the current fixed
// window. A single INSERT ... ON CONFLICT DO UPDATE takes a row lock, so
// concurrent requests (even across serverless instances) cannot both slip
// past the limit. Blocked attempts are not counted.
// Returns { ok: true } or { ok: false, retryAfter } (seconds).
export async function takeHit(sql, key, { limit, windowSeconds }) {
  const rows = await sql`
    WITH hit AS (
      INSERT INTO rate_limits AS r (key, window_start, hits) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        window_start = CASE WHEN r.window_start <= now() - ${windowSeconds}::int * interval '1 second'
                            THEN now() ELSE r.window_start END,
        hits = CASE WHEN r.window_start <= now() - ${windowSeconds}::int * interval '1 second'
                    THEN 1 ELSE r.hits + 1 END
      WHERE r.window_start <= now() - ${windowSeconds}::int * interval '1 second' OR r.hits < ${limit}::int
      RETURNING hits
    )
    SELECT (SELECT hits FROM hit) AS hits,
      (SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM
         r.window_start + ${windowSeconds}::int * interval '1 second' - now())))::int
       FROM rate_limits r WHERE r.key = ${key}) AS retry_after`;
  const row = rows[0] || {};
  return row.hits != null ? { ok: true } : { ok: false, retryAfter: Number(row.retry_after) || windowSeconds };
}

const envLimit = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : fallback;
};

// Per-user limits for actions that cost us money or storage. Each has a short
// burst limit and a daily cap; both can be tuned with <ENV>_PER_HOUR/_PER_DAY.
// - swap-analyze: free for the user, but a full video download + paid provider call.
// - generate: paid in credits; the limit stops runaway clients and request spam.
// - upload: each signed URL lets the user put up to 50MB into R2. One swap needs
//   up to 5 uploads (video + 4 portraits), Me in Video needs 2.
export const POLICIES = Object.freeze({
  'swap-analyze': { noun: 'video scans', env: 'SWAP_ANALYSES', perHour: 10, perDay: 30 },
  generate: { noun: 'generations', env: 'GENERATIONS', perHour: 20, perDay: 100 },
  upload: { noun: 'uploads', env: 'UPLOADS', perHour: 60, perDay: 300 },
});

export function limitsFor(action) {
  const p = POLICIES[action];
  if (!p) throw Error(`Unknown rate-limit action: ${action}`);
  return {
    perHour: envLimit(`${p.env}_PER_HOUR`, p.perHour),
    perDay: envLimit(`${p.env}_PER_DAY`, p.perDay),
  };
}

function waitText(seconds) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${Math.ceil(minutes / 60)} hours`;
}

// Throws a 429 if the user is over either limit for this action. The hourly
// check runs first so that a client hammering the burst limit does not burn
// its daily allowance with rejected requests.
export async function enforceRateLimit(sql, action, userId) {
  const { perHour, perDay } = limitsFor(action);
  const { noun } = POLICIES[action];
  for (const [window, limit, windowSeconds] of [['hour', perHour, 3600], ['day', perDay, 86400]]) {
    const result = await takeHit(sql, `${action}:${window}:${userId}`, { limit, windowSeconds });
    if (!result.ok) {
      throw tooManyRequests(
        `You've reached the limit of ${limit} ${noun} per ${window}. Try again in ${waitText(result.retryAfter)}.`,
        result.retryAfter,
      );
    }
  }
}
