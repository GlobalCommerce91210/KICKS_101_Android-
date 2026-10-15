-- Apply after the base schema, as the schema owner, before account/consent traffic.
-- Narrow compatibility migration; collector ingestion/marketplace migrations remain separate.
BEGIN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vault_id uuid;
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES devices(id);
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS vault_id uuid;
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS activation_id uuid;
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS activation_vault_id uuid;
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS activation_request_id uuid;
-- DataStorm account IDs are opaque strings; existing UUID actors retain their values.
ALTER TABLE audit_events ALTER COLUMN actor_id TYPE text USING actor_id::text;
CREATE INDEX IF NOT EXISTS consent_events_current_idx
  ON consent_events(device_id,subject_id,permission_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS consent_events_activation_request_idx
  ON consent_events(device_id,activation_request_id);
COMMIT;
