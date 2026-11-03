-- Run once in the existing VisionAI Neon database. Does not delete users/credits/jobs.
CREATE TABLE IF NOT EXISTS swap_projects (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  video_key TEXT NOT NULL,
  provider_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'ANALYZING',
  detected_cast JSONB NOT NULL DEFAULT '[]'::jsonb,
  seconds INTEGER,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  image_keys JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_key TEXT,
  error_message TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  notification_state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS swap_projects_user_idx ON swap_projects(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS swap_projects_active_idx ON swap_projects(status) WHERE status IN ('ANALYZING','RENDERING','STITCHING','SAVING');
