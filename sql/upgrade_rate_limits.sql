-- Run once in the Neon database used by Vercel's DATABASE_URL (after upgrade_viggle.sql).
-- Fixed-window counters for per-user rate limits (e.g. free swap video analysis).
-- One row per user per limit, reused across windows, so the table stays small.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0)
);
