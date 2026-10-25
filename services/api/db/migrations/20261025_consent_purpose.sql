-- KICK-011A: persist the purpose associated with each immutable consent event.
-- Existing events are explicitly marked as legacy so they cannot authorize purpose-specific ingestion.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS purpose text;
UPDATE consent_events SET purpose = 'legacy-unavailable' WHERE purpose IS NULL;
ALTER TABLE consent_events ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS event_sequence bigserial;
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_event_sequence_uq ON consent_events(event_sequence);

-- Idempotency keys preserve the outcome when clients safely retry after timeouts.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS request_id uuid;
UPDATE consent_events SET request_id = id WHERE request_id IS NULL;
ALTER TABLE consent_events ALTER COLUMN request_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_request_id_uq ON consent_events(request_id);

-- Preserve the expected per-permission sequence as part of the idempotent request payload.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS expected_event_sequence bigint;
