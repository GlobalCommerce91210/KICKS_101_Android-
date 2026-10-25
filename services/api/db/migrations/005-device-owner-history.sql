-- Refuse ambiguous historical ownership; do not delete or rewrite existing records.
BEGIN;
LOCK TABLE consumer_device_bindings IN SHARE ROW EXCLUSIVE MODE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumer_device_owner_history ON consumer_device_bindings(device_id);
CREATE OR REPLACE FUNCTION preserve_device_owner_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Device ownership history cannot be deleted'; END IF;
  IF NEW.subject_id<>OLD.subject_id OR NEW.device_id<>OLD.device_id OR
     NEW.collector_subject_id<>OLD.collector_subject_id OR NEW.platform<>OLD.platform OR
     (OLD.status='revoked' AND NEW.status<>'revoked') THEN
    RAISE EXCEPTION 'Device ownership or revoked enrollment cannot be replaced';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_device_owner ON consumer_device_bindings;
CREATE TRIGGER immutable_device_owner BEFORE UPDATE OR DELETE ON consumer_device_bindings
  FOR EACH ROW EXECUTE FUNCTION preserve_device_owner_history();
COMMIT;
