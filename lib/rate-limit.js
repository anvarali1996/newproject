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

export function swapAnalysisLimits() {
  return {
    perHour: envLimit('SWAP_ANALYSES_PER_HOUR', 10),
    perDay: envLimit('SWAP_ANALYSES_PER_DAY', 30),
  };
}

function waitText(seconds) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${Math.ceil(minutes / 60)} hours`;
}

// Video analysis is free for the user but costs a paid provider call (and a
// full video download), so it is capped per user: a short burst limit plus a
// daily cap. The hourly check runs first so that a client hammering the burst
// limit does not burn its daily allowance with rejected requests.
export async function limitSwapAnalysis(sql, userId) {
  const { perHour, perDay } = swapAnalysisLimits();
  for (const [key, limit, windowSeconds, label] of [
    [`swap-analyze:hour:${userId}`, perHour, 3600, 'per hour'],
    [`swap-analyze:day:${userId}`, perDay, 86400, 'per day'],
  ]) {
    const result = await takeHit(sql, key, { limit, windowSeconds });
    if (!result.ok) {
      throw tooManyRequests(
        `You can scan up to ${limit} videos ${label}. Try again in ${waitText(result.retryAfter)}.`,
        result.retryAfter,
      );
    }
  }
}
