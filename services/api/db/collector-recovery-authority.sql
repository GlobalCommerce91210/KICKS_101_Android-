-- Apply ONLY to the independently backed-up revocation authority database.
-- No initial checkpoint is created: an operator must establish a reviewed epoch
-- and clear the recovery hold after reconciling revocations and primary state.
CREATE TABLE IF NOT EXISTS collector_recovery_checkpoint (
  singleton boolean PRIMARY KEY CHECK(singleton), epoch uuid NOT NULL, held boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS collector_revocations (
  device_id text NOT NULL, activation_id text NOT NULL, revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id,activation_id)
);
CREATE OR REPLACE FUNCTION preserve_collector_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Collector revocations are permanent'; END $$;
DROP TRIGGER IF EXISTS collector_revocations_immutable ON collector_revocations;
CREATE TRIGGER collector_revocations_immutable BEFORE UPDATE OR DELETE ON collector_revocations
  FOR EACH ROW EXECUTE FUNCTION preserve_collector_revocation();
DROP TRIGGER IF EXISTS collector_revocations_no_truncate ON collector_revocations;
CREATE TRIGGER collector_revocations_no_truncate BEFORE TRUNCATE ON collector_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION preserve_collector_revocation();
REVOKE UPDATE, DELETE, TRUNCATE ON collector_revocations FROM PUBLIC;
