-- Additive Operations model. Historical sessions retain their original workspace.
ALTER TABLE plants ADD COLUMN operations_revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION nabat_plant_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.name,NEW.location_id,NEW.organisation_id,NEW.public_passport,NEW.origin)
 IS DISTINCT FROM ROW(OLD.name,OLD.location_id,OLD.organisation_id,OLD.public_passport,OLD.origin) THEN
  NEW.operations_revision := OLD.operations_revision + 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER plant_operations_revision BEFORE UPDATE ON plants FOR EACH ROW EXECUTE FUNCTION nabat_plant_revision();
CREATE FUNCTION nabat_assignment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE plants SET operations_revision=operations_revision+1 WHERE id=NEW.plant_id;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_operations_revision AFTER INSERT OR UPDATE ON plant_assignments FOR EACH ROW EXECUTE FUNCTION nabat_assignment_revision();

CREATE TABLE operations_tasks (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), plant_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('watered','fertilised','inspected','observation','repotted','follow_up')),
 title text NOT NULL, source text NOT NULL CHECK(source IN ('scheduled','overdue','alert','decline','manual')),
 source_key text NOT NULL, due_at timestamptz NOT NULL, assignee_id uuid REFERENCES users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
 revision integer NOT NULL DEFAULT 0, created_by uuid REFERENCES users(id), completed_by uuid REFERENCES users(id),
 completed_at timestamptz, care_event_id uuid REFERENCES care_events(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organisation_id,source_key), UNIQUE(id,organisation_id),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE INDEX operations_tasks_queue ON operations_tasks(organisation_id,status,due_at);
CREATE INDEX operations_tasks_assignee ON operations_tasks(organisation_id,assignee_id,status);

CREATE TABLE maintenance_sessions (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), location_id uuid,
 owner_id uuid NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, revision integer NOT NULL DEFAULT 0,
 summary jsonb NOT NULL DEFAULT '{}', UNIQUE(id,organisation_id),
 FOREIGN KEY(location_id,organisation_id) REFERENCES locations(id,organisation_id)
);
CREATE INDEX maintenance_sessions_org ON maintenance_sessions(organisation_id,status,started_at DESC);
CREATE TABLE maintenance_session_plants (
 session_id uuid NOT NULL REFERENCES maintenance_sessions(id), plant_id uuid NOT NULL REFERENCES plants(id),
 plant_name text NOT NULL, plant_code text NOT NULL, visited_at timestamptz,
 PRIMARY KEY(session_id,plant_id)
);
CREATE TABLE maintenance_session_events (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES maintenance_sessions(id), plant_id uuid NOT NULL REFERENCES plants(id),
 care_event_id uuid UNIQUE REFERENCES care_events(id), type text NOT NULL CHECK(type IN ('watered','fertilised','inspected','issue','observation')),
 actor_id uuid NOT NULL REFERENCES users(id), occurred_at timestamptz NOT NULL DEFAULT now(), note text NOT NULL DEFAULT ''
);
CREATE INDEX maintenance_events_session ON maintenance_session_events(session_id,occurred_at);

CREATE TABLE operations_mutations (
 organisation_id uuid NOT NULL REFERENCES organisations(id), actor_id uuid NOT NULL REFERENCES users(id),
 idempotency_key uuid NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organisation_id,actor_id,idempotency_key)
);
CREATE TABLE operations_saved_views (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations(id), actor_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL, filters jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alerts DROP CONSTRAINT alerts_status_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_status_check CHECK(status IN ('open','acknowledged','assigned','in_progress','resolved','reopened'));
ALTER TABLE alerts ADD COLUMN assignee_id uuid REFERENCES users(id);
ALTER TABLE alerts ADD COLUMN resolution_note text NOT NULL DEFAULT '';
ALTER TABLE alerts ADD COLUMN resolved_at timestamptz;
ALTER TABLE alerts ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE FUNCTION nabat_alert_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.revision := OLD.revision+1;
 IF NEW.status='resolved' AND OLD.status<>'resolved' THEN NEW.resolved_at := now(); END IF;
 IF NEW.status<>'resolved' THEN NEW.resolved_at := null; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alert_operations_revision BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION nabat_alert_revision();
