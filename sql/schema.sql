CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_key TEXT NOT NULL,
  secondary_source_key TEXT,
  duration_seconds INTEGER,
  mode TEXT NOT NULL CHECK (mode IN ('image','video','act')),
  prompt TEXT NOT NULL,
  cost INTEGER NOT NULL,
  runway_id TEXT,
  status TEXT NOT NULL DEFAULT 'STARTING',
  output_url TEXT,
  output_key TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS topup_orders (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  pack_id TEXT NOT NULL, stars INTEGER NOT NULL CHECK (stars>0),
  credits INTEGER NOT NULL CHECK (credits>0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS star_payments (
  charge_id TEXT PRIMARY KEY, order_id UUID UNIQUE NOT NULL REFERENCES topup_orders(id),
  user_id TEXT NOT NULL REFERENCES users(id), stars INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS topup_user_idx ON topup_orders(user_id,created_at DESC);
