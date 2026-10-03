ALTER TABLE plant_photos ADD COLUMN IF NOT EXISTS care_event_id uuid REFERENCES care_events(id);
CREATE INDEX IF NOT EXISTS photos_care_event ON plant_photos(care_event_id);
