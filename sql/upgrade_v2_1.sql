-- Run once in the SAME Neon database used by Vercel's DATABASE_URL.
-- Requires the users and jobs tables from VisionAI 2.0.
-- Referral credits: only new Telegram users; +2 to the inviter; 10/day, 100 lifetime.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_total_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_daily_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_day DATE NOT NULL DEFAULT DATE '1970-01-01';

CREATE TABLE IF NOT EXISTS referral_awards (
  referred_id TEXT PRIMARY KEY REFERENCES users(id),
  referrer_id TEXT NOT NULL REFERENCES users(id),
  credits INTEGER NOT NULL CHECK (credits=2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_referral CHECK (referrer_id <> referred_id)
);
CREATE INDEX IF NOT EXISTS referrer_awards_idx ON referral_awards (referrer_id, created_at DESC);

-- These are actual server-side credit rates. Changing values here changes
-- backend billing; frontend reads them from GET /api/pricing.
CREATE TABLE IF NOT EXISTS credit_rates (
  mode TEXT PRIMARY KEY CHECK (mode IN ('image','act','video')),
  credits_per_second INTEGER NOT NULL CHECK (credits_per_second > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO credit_rates(mode,credits_per_second) VALUES
  ('image',1),('act',2),('video',6)
ON CONFLICT(mode) DO NOTHING;
