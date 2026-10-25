-- KICK-011A: persist the purpose associated with each immutable consent event.
-- Existing events are explicitly marked as legacy so they cannot authorize purpose-specific ingestion.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS purpose text;
UPDATE consent_events SET purpose = 'legacy-unavailable' WHERE purpose IS NULL;
ALTER TABLE consent_events ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS event_sequence bigint;
ALTER TABLE consent_events ALTER COLUMN event_sequence DROP DEFAULT;
DO $migration$
DECLARE
  has_legacy_global_sequence boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_index AS idx
    WHERE idx.indrelid = 'consent_events'::regclass
      AND idx.indisunique
      AND idx.indnkeyatts = 1
      AND idx.indkey[0] = (
        SELECT attribute.attnum
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid = idx.indrelid
          AND attribute.attname = 'event_sequence'
          AND NOT attribute.attisdropped
      )
  ) INTO has_legacy_global_sequence;

  -- Convert the old globally allocated sequence once. The new stream index is
  -- composite, so rerunning this migration leaves already-assigned values alone.
  IF has_legacy_global_sequence THEN
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
    WHERE event.id = ordered_events.id;
  END IF;
END
$migration$;
ALTER TABLE consent_events DROP CONSTRAINT IF EXISTS consent_events_event_sequence_key;
DROP INDEX IF EXISTS consent_events_event_sequence_uq;
WITH stream_heads AS (
  SELECT permission_id, COALESCE(MAX(event_sequence), 0) AS last_sequence
  FROM consent_events
  GROUP BY permission_id
), missing_sequences AS (
  SELECT event.id,
    stream_heads.last_sequence
      + row_number() OVER (PARTITION BY event.permission_id ORDER BY event.occurred_at, event.id) AS sequence
  FROM consent_events AS event
  JOIN stream_heads USING (permission_id)
  WHERE event.event_sequence IS NULL
)
UPDATE consent_events AS event
SET event_sequence = missing_sequences.sequence
FROM missing_sequences
WHERE event.id = missing_sequences.id;
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
ALTER TABLE consent_events DROP CONSTRAINT IF EXISTS consent_events_request_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_request_id_uq ON consent_events(request_id);

-- Preserve the expected per-permission sequence as part of the idempotent request payload.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS expected_event_sequence bigint;
