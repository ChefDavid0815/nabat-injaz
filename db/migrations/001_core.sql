CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organisations (
 id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('personal','business')),
 plan text NOT NULL DEFAULT 'personal' CHECK(plan IN ('personal','pro','business')),
 timezone text NOT NULL DEFAULT 'Asia/Dubai', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organisation_memberships (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','admin','manager','caretaker')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,user_id)
);
CREATE TABLE IF NOT EXISTS locations (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), name text NOT NULL,
 parent_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organisation_id),
 FOREIGN KEY(parent_id,organisation_id) REFERENCES locations(id,organisation_id), CHECK(id IS DISTINCT FROM parent_id)
);
CREATE TABLE IF NOT EXISTS plant_species (
 id uuid PRIMARY KEY, common_name text NOT NULL, scientific_name text NOT NULL, light text NOT NULL,
 temperature_min numeric NOT NULL, temperature_max numeric NOT NULL, watering_days integer NOT NULL CHECK(watering_days>0),
 fertilising_days integer NOT NULL DEFAULT 30, guidance text NOT NULL
);
CREATE TABLE IF NOT EXISTS plants (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), code text NOT NULL UNIQUE, name text NOT NULL,
 species_id uuid NOT NULL REFERENCES plant_species(id), location_id uuid, origin text NOT NULL DEFAULT '',
 acquired_at date, public_passport boolean NOT NULL DEFAULT true, demo_image text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organisation_id), FOREIGN KEY(location_id,organisation_id) REFERENCES locations(id,organisation_id)
);
CREATE TABLE IF NOT EXISTS plant_tags (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, public_token text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked','replaced')), activated_at timestamptz NOT NULL DEFAULT now(),
 last_interaction_at timestamptz, replaced_by uuid REFERENCES plant_tags(id),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_tag ON plant_tags(plant_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS care_events (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 type text NOT NULL CHECK(type IN ('watered','fertilised','repotted','moved','inspected','assigned')),
 amount_ml integer CHECK(amount_ml BETWEEN 0 AND 100000), note text NOT NULL DEFAULT '', location_id uuid,
 idempotency_key uuid NOT NULL UNIQUE, occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS plant_photos (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 object_key text NOT NULL, thumbnail_key text NOT NULL, mime_type text NOT NULL, bytes integer NOT NULL CHECK(bytes>0),
 width integer NOT NULL, height integer NOT NULL, original_metadata jsonb NOT NULL DEFAULT '{}',
 note text NOT NULL DEFAULT '', source text NOT NULL DEFAULT 'photo' CHECK(source IN ('photo','sensor','fixture')),
 captured_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS analysis_jobs (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, photo_id uuid NOT NULL UNIQUE REFERENCES plant_photos(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
 error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS visual_analyses (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, photo_id uuid NOT NULL UNIQUE REFERENCES plant_photos(id),
 provider text NOT NULL, model text NOT NULL, contract_version text NOT NULL, prompt_version text NOT NULL,
 features jsonb NOT NULL, comparison jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS health_score_snapshots (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, analysis_id uuid REFERENCES visual_analyses(id),
 score integer NOT NULL CHECK(score BETWEEN 0 AND 100), delta integer NOT NULL, trend text NOT NULL CHECK(trend IN ('improving','stable','declining','baseline')),
 confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1), composition jsonb NOT NULL, reasons jsonb NOT NULL,
 engine_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS alerts (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL,
 rule text NOT NULL, severity text NOT NULL CHECK(severity IN ('watch','attention','critical')),
 reason text NOT NULL, recommended_action text NOT NULL, source_id uuid, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS open_alert_rule ON alerts(plant_id,rule) WHERE status <> 'resolved';
CREATE TABLE IF NOT EXISTS alert_status_events (
 id uuid PRIMARY KEY, alert_id uuid NOT NULL REFERENCES alerts(id), actor_id uuid REFERENCES users(id),
 status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plant_assignments (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 assigned_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_assignee ON plant_assignments(plant_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS ownership_transfers (
 id uuid PRIMARY KEY, plant_id uuid NOT NULL REFERENCES plants(id), from_organisation_id uuid NOT NULL REFERENCES organisations(id),
 to_organisation_id uuid NOT NULL REFERENCES organisations(id), requested_by uuid NOT NULL REFERENCES users(id), accepted_by uuid REFERENCES users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')), created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 CHECK(from_organisation_id <> to_organisation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_transfer ON ownership_transfers(plant_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), actor_id uuid REFERENCES users(id),
 action text NOT NULL, entity_id uuid, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS memberships_user ON organisation_memberships(user_id);
CREATE INDEX IF NOT EXISTS plants_org ON plants(organisation_id,location_id);
CREATE INDEX IF NOT EXISTS care_plant_time ON care_events(plant_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS photo_plant_time ON plant_photos(plant_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS snapshot_plant_time ON health_score_snapshots(plant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_org_status ON alerts(organisation_id,status);
CREATE INDEX IF NOT EXISTS jobs_ready ON analysis_jobs(status,available_at);
