ALTER TABLE organisation_memberships DROP CONSTRAINT organisation_memberships_role_check;
ALTER TABLE organisation_memberships ADD CONSTRAINT organisation_memberships_role_check CHECK(role IN ('owner','admin','manager','caretaker','viewer'));
ALTER TABLE locations ADD COLUMN kind text NOT NULL DEFAULT 'area' CHECK(kind IN ('site','building','floor','zone','room','area'));
ALTER TABLE locations ADD COLUMN default_caretaker_id uuid REFERENCES users(id);
ALTER TABLE locations ADD COLUMN critical boolean NOT NULL DEFAULT false;
ALTER TABLE maintenance_session_events DROP CONSTRAINT maintenance_session_events_type_check;
ALTER TABLE maintenance_session_events ADD CONSTRAINT maintenance_session_events_type_check CHECK(type IN ('watered','fertilised','inspected','repotted','moved','issue','observation'));
ALTER TABLE maintenance_session_events ADD COLUMN observation_id uuid UNIQUE REFERENCES observations(id);
CREATE TABLE location_floor_plans(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES organisations(id),location_id uuid NOT NULL,
 object_key text NOT NULL,width integer NOT NULL,height integer NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(location_id,organisation_id),
 FOREIGN KEY(location_id,organisation_id) REFERENCES locations(id,organisation_id)
);
CREATE TABLE location_plant_pins(
 plant_id uuid PRIMARY KEY,organisation_id uuid NOT NULL,location_id uuid NOT NULL,
 x numeric NOT NULL CHECK(x BETWEEN 0 AND 1),y numeric NOT NULL CHECK(y BETWEEN 0 AND 1),
 revision integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE,
 FOREIGN KEY(location_id,organisation_id) REFERENCES locations(id,organisation_id)
);
CREATE FUNCTION nabat_pin_movement_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
  DELETE FROM location_plant_pins WHERE plant_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER plant_pin_movement_cleanup AFTER UPDATE OF location_id,organisation_id ON plants FOR EACH ROW EXECUTE FUNCTION nabat_pin_movement_cleanup();
CREATE TABLE plant_issues(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL,plant_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
 note text NOT NULL,severity text NOT NULL CHECK(severity IN ('watch','attention','critical')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE TABLE tag_programming_events(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES organisations(id),tag_id uuid NOT NULL REFERENCES plant_tags(id),
 actor_id uuid NOT NULL REFERENCES users(id),reader text NOT NULL,uid text NOT NULL,resolver_hash text NOT NULL,
 verification text NOT NULL CHECK(verification IN ('simulated','client_read_back')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tag_programming_history ON tag_programming_events(tag_id,created_at DESC);
CREATE TABLE photo_import_batches(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL REFERENCES organisations(id),actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed'))
);
CREATE TABLE photo_import_items(
 id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES photo_import_batches(id),filename text NOT NULL,
 plant_id uuid REFERENCES plants(id),status text NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','ready','uploading','saved','failed')),
 photo_id uuid REFERENCES plant_photos(id),error text,revision integer NOT NULL DEFAULT 0,
 captured_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_items_batch ON photo_import_items(batch_id,status);
