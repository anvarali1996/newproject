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
  mode TEXT NOT NULL CHECK (mode IN ('image','video')),
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
