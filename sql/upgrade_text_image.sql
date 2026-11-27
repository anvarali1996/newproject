-- Run once in Neon SQL Editor, on the same database as Vercel's DATABASE_URL,
-- after upgrade_omni.sql. Adds "Text to Image" (text2img): the user writes a
-- prompt and picks Runway (gen4_image) or Google Gemini (Nano Banana 2.1).
BEGIN;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_mode_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_mode_check CHECK (mode IN ('image','video','act','hd','text2img'));
-- A text prompt has no uploaded source file.
ALTER TABLE jobs ALTER COLUMN source_key DROP NOT NULL;

ALTER TABLE credit_rates DROP CONSTRAINT IF EXISTS credit_rates_mode_check;
ALTER TABLE credit_rates ADD CONSTRAINT credit_rates_mode_check CHECK (mode IN ('image','act','video','hd','text2img'));

-- For text2img, credits_per_second means credits per image. Providers charge
-- about $0.05 (Runway, 720p) and $0.034 (Gemini, 1K) per image.
INSERT INTO credit_rates(mode,credits_per_second) VALUES ('text2img',1)
ON CONFLICT(mode) DO NOTHING;
COMMIT;
