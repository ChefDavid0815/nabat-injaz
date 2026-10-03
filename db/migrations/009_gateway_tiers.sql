-- AI entitlements are assigned by trusted billing/admin code, never workspace creation input.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS ai_tier text NOT NULL DEFAULT 'free'
 CHECK(ai_tier IN ('free','plus','pro','enterprise'));
CREATE TABLE IF NOT EXISTS ai_generations (
 id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
 tier text NOT NULL CHECK(tier IN ('free','plus','pro','enterprise')),
 model text NOT NULL,
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','failed')),
 reserved_usd numeric NOT NULL CHECK(reserved_usd>=0),
 cost_usd numeric CHECK(cost_usd>=0),
 cost_source text CHECK(cost_source IN ('gateway','catalog-estimate')),
 input_tokens integer,
 output_tokens integer,
 cached_tokens integer,
 reasoning_tokens integer,
 generation_id text,
 duration_ms integer,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_generations_month ON ai_generations(created_at);
CREATE INDEX IF NOT EXISTS ai_generations_workspace_day ON ai_generations(organisation_id,created_at);
