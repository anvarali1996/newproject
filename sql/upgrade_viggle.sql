-- Run in Neon SQL Editor on the same database used by Vercel DATABASE_URL.
-- Existing jobs remain associated with Runway.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'runway';

-- Optional only after confirming Viggle quality and your economics:
-- UPDATE credit_rates SET credits_per_second = 1 WHERE mode = 'act';
