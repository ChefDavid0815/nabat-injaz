ALTER TABLE plants ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','retired','replaced'));
CREATE TABLE plant_lifecycle_events(
 id uuid PRIMARY KEY,organisation_id uuid NOT NULL,plant_id uuid NOT NULL,actor_id uuid REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('acquired','retired','replaced')),reason text NOT NULL DEFAULT '',
 outcome text CHECK(outcome IN ('died','replaced','relocated','other')),
 replacement_plant_id uuid REFERENCES plants(id),occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
CREATE INDEX plant_lifecycle_time ON plant_lifecycle_events(organisation_id,occurred_at);
CREATE TABLE plant_labels(
 plant_id uuid NOT NULL,organisation_id uuid NOT NULL,label text NOT NULL CHECK(length(label) BETWEEN 1 AND 48),
 PRIMARY KEY(plant_id,label),FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
