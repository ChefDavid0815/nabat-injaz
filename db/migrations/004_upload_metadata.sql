ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
