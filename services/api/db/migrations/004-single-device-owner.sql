-- Additive ownership invariant. Existing conflicting records must be reviewed;
-- this migration intentionally does not delete, revoke or reassign any binding.
BEGIN;
LOCK TABLE consumer_device_bindings IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT device_id FROM consumer_device_bindings WHERE status='active'
    GROUP BY device_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Multiple active device owners require explicit reconciliation before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_consumer_device_single_owner
  ON consumer_device_bindings(device_id) WHERE status='active';
COMMIT;
