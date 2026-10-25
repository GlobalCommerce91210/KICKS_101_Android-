-- KICK-011A: persist the purpose associated with each immutable consent event.
-- Existing events are explicitly marked as legacy so they cannot authorize purpose-specific ingestion.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS purpose text;
UPDATE consent_events SET purpose = 'legacy-unavailable' WHERE purpose IS NULL;
ALTER TABLE consent_events ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS event_sequence bigint;
ALTER TABLE consent_events ALTER COLUMN event_sequence DROP DEFAULT;
ALTER TABLE consent_events DROP CONSTRAINT IF EXISTS consent_events_event_sequence_key;
DROP INDEX IF EXISTS consent_events_event_sequence_uq;
WITH ordered_events AS (
  SELECT id, row_number() OVER (
    PARTITION BY permission_id ORDER BY event_sequence NULLS LAST, occurred_at, id
  ) AS sequence
  FROM consent_events
)
UPDATE consent_events AS event
SET event_sequence = ordered_events.sequence
FROM ordered_events
WHERE event.id = ordered_events.id
  AND event.event_sequence IS DISTINCT FROM ordered_events.sequence;
ALTER TABLE consent_events ALTER COLUMN event_sequence SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_permission_sequence_uq
  ON consent_events(permission_id, event_sequence);
CREATE TABLE IF NOT EXISTS consent_permission_sequences (
  permission_id uuid PRIMARY KEY, last_sequence bigint NOT NULL CHECK (last_sequence >= 0)
);
INSERT INTO consent_permission_sequences (permission_id, last_sequence)
SELECT permission_id, MAX(event_sequence)
FROM consent_events
GROUP BY permission_id
ON CONFLICT (permission_id) DO UPDATE
SET last_sequence = GREATEST(consent_permission_sequences.last_sequence, EXCLUDED.last_sequence);

-- Idempotency keys preserve the outcome when clients safely retry after timeouts.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS request_id uuid;
UPDATE consent_events SET request_id = id WHERE request_id IS NULL;
ALTER TABLE consent_events ALTER COLUMN request_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_request_id_uq ON consent_events(request_id);

-- Preserve the expected per-permission sequence as part of the idempotent request payload.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS expected_event_sequence bigint;
