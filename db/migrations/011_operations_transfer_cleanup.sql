-- V1.0 transfers still carry plant history. Work cannot keep a source-tenant assignee.
CREATE FUNCTION nabat_operations_transfer_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
  INSERT INTO alert_status_events(id,alert_id,status)
   SELECT gen_random_uuid(),id,'reopened' FROM alerts
   WHERE plant_id=NEW.id AND status IN ('assigned','in_progress');
  UPDATE alerts SET assignee_id=null,
   status=CASE WHEN status IN ('assigned','in_progress') THEN 'reopened' ELSE status END,
   updated_at=now() WHERE plant_id=NEW.id;
  UPDATE operations_tasks SET assignee_id=null,
   status=CASE WHEN status='in_progress' THEN 'pending' ELSE status END,
   revision=revision+1,updated_at=now() WHERE plant_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER plant_operations_transfer_cleanup AFTER UPDATE OF organisation_id ON plants
 FOR EACH ROW EXECUTE FUNCTION nabat_operations_transfer_cleanup();
