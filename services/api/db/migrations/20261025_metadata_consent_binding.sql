-- Bind newly ingested observations to the exact consent event and versions
-- that authorized them. Existing observations are marked as legacy and do not
-- claim a consent event that cannot be established retroactively.
UPDATE consent_events
SET expected_event_sequence = event_sequence - 1
WHERE expected_event_sequence IS NULL;

ALTER TABLE metadata_observations
  ADD COLUMN IF NOT EXISTS consent_event_id uuid REFERENCES consent_events(id);
ALTER TABLE metadata_observations
  ADD COLUMN IF NOT EXISTS consent_policy_version text;
ALTER TABLE metadata_observations
  ADD COLUMN IF NOT EXISTS consent_purpose_version text;

UPDATE metadata_observations
SET consent_policy_version = 'legacy-unavailable'
WHERE consent_policy_version IS NULL;
UPDATE metadata_observations
SET consent_purpose_version = 'legacy-unavailable'
WHERE consent_purpose_version IS NULL;

ALTER TABLE metadata_observations
  ALTER COLUMN consent_policy_version SET NOT NULL,
  ALTER COLUMN consent_purpose_version SET NOT NULL;
