-- Run once in Neon SQL Editor, on the same database as Vercel's DATABASE_URL,
-- after upgrade_rate_limits.sql. Adds the "Photo to Video HD" mode (hd), which
-- runs on Google Gemini Omni Flash: 720p, 9:16, with generated sound.
BEGIN;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_mode_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_mode_check CHECK (mode IN ('image','video','act','hd'));

ALTER TABLE credit_rates DROP CONSTRAINT IF EXISTS credit_rates_mode_check;
ALTER TABLE credit_rates ADD CONSTRAINT credit_rates_mode_check CHECK (mode IN ('image','act','video','hd'));

-- Omni costs about $0.07/s at 720p; 2 credits (~$0.21-0.26) per second keeps a margin.
INSERT INTO credit_rates(mode,credits_per_second) VALUES ('hd',2)
ON CONFLICT(mode) DO NOTHING;
COMMIT;
