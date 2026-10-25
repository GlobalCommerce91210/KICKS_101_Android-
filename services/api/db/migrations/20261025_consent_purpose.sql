-- KICK-011A: persist the purpose associated with each immutable consent event.
-- Existing events are explicitly marked as legacy so they cannot authorize purpose-specific ingestion.
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS purpose text;
UPDATE consent_events SET purpose = 'legacy-unavailable' WHERE purpose IS NULL;
ALTER TABLE consent_events ALTER COLUMN purpose SET NOT NULL;
