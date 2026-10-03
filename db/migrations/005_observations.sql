CREATE TABLE IF NOT EXISTS observations (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, plant_id uuid NOT NULL, actor_id uuid REFERENCES users(id),
 source text NOT NULL CHECK(source IN ('photo','note','sensor')), photo_id uuid UNIQUE REFERENCES plant_photos(id),
 metrics jsonb NOT NULL DEFAULT '{}', note text NOT NULL DEFAULT '', captured_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plant_id,organisation_id) REFERENCES plants(id,organisation_id) ON UPDATE CASCADE,
 CHECK(source <> 'photo' OR photo_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS observations_plant_time ON observations(plant_id,captured_at DESC);
INSERT INTO observations(id,organisation_id,plant_id,actor_id,source,photo_id,note,captured_at)
 SELECT id,organisation_id,plant_id,actor_id,'photo',id,note,captured_at FROM plant_photos ON CONFLICT(id) DO NOTHING;
