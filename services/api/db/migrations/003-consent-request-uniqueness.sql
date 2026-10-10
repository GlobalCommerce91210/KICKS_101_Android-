-- Preflight existing duplicates before applying. This migration never deletes ledger rows.
-- If duplicates exist, index creation fails and needs explicit reconciliation.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_device_request_unique
  ON consent_events(device_id,activation_request_id)
  WHERE activation_request_id IS NOT NULL;
COMMIT;
