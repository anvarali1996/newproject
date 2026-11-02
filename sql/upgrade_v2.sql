-- RUN ONCE in Neon SQL Editor BEFORE deploying VisionAI v2.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS secondary_source_key TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_mode_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_mode_check CHECK (mode IN ('image','video','act'));
CREATE TABLE IF NOT EXISTS topup_orders (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  pack_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars > 0),
  credits INTEGER NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS star_payments (
  charge_id TEXT PRIMARY KEY,
  order_id UUID UNIQUE NOT NULL REFERENCES topup_orders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS topup_user_idx ON topup_orders(user_id,created_at DESC);
