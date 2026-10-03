CREATE TABLE IF NOT EXISTS workspace_agent_dispatches (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
 organisation_id uuid NOT NULL,
 trigger_id text NOT NULL,
 capability_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 active boolean NOT NULL DEFAULT true,
 send_attempts integer NOT NULL DEFAULT 0,
 remote_status text NOT NULL DEFAULT 'dispatching',
 run_id text,
 conversation_url text,
 next_action_at timestamptz NOT NULL DEFAULT now(),
 completed_seen_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_agent_current_job ON workspace_agent_dispatches(job_id) WHERE active;
CREATE INDEX IF NOT EXISTS workspace_agent_pending ON workspace_agent_dispatches(next_action_at) WHERE active;
