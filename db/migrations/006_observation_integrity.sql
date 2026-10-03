CREATE UNIQUE INDEX IF NOT EXISTS photos_identity_tenant ON plant_photos(id,plant_id,organisation_id);
ALTER TABLE observations ADD CONSTRAINT observation_photo_tenant FOREIGN KEY(photo_id,plant_id,organisation_id) REFERENCES plant_photos(id,plant_id,organisation_id) ON UPDATE CASCADE;
