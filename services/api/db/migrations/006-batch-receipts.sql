BEGIN;
ALTER TABLE metadata_batches ADD COLUMN IF NOT EXISTS payload_digest text;
ALTER TABLE metadata_batches ADD COLUMN IF NOT EXISTS receipt_id uuid;
ALTER TABLE metadata_batches ADD COLUMN IF NOT EXISTS committed_at timestamptz;
-- Legacy rows intentionally retain NULL: their original payload cannot be proven.
COMMIT;
