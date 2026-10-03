CREATE TABLE IF NOT EXISTS media_uploads (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','processing','completed')),
 photo_id uuid REFERENCES plant_photos(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE
);
