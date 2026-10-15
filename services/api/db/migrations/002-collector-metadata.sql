-- Apply after schema.sql and 001-account-consent.sql, as schema owner.
-- Supports existing metadata ingestion/enrichment; adds no consumer-facing features.
BEGIN;
CREATE TABLE IF NOT EXISTS app_instances (
  id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), package_name text NOT NULL,
  app_name text, app_category text, installed_at timestamptz, last_updated_at timestamptz,
  is_system_app boolean, app_version_name text, app_version_code text,
  signing_certificate_sha256 text, attribution_method text, attribution_confidence integer,
  first_observed_at timestamptz NOT NULL, last_observed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active', status_verified_at timestamptz,
  observation_count bigint NOT NULL DEFAULT 1, record_version integer NOT NULL DEFAULT 1,
  UNIQUE(device_id,package_name)
);
CREATE TABLE IF NOT EXISTS domain_registry (
  id uuid PRIMARY KEY, domain text NOT NULL, parent_company text, service_brand text,
  corporate_parent_legal_name text, corporate_parent_verification_status text,
  corporate_parent_verified_at timestamptz, ownership_confidence integer, function_confidence integer,
  commercial_function text, subcategory text, purpose text, data_category text, confidence_score integer,
  classification_source text, review_status text, record_status text,
  registry_version text, record_version integer NOT NULL DEFAULT 1,
  first_seen timestamptz, last_updated timestamptz, evidence_hash text
);
CREATE TABLE IF NOT EXISTS domain_registry_evidence (
  id uuid PRIMARY KEY, domain_registry_id uuid NOT NULL REFERENCES domain_registry(id),
  evidence_type text, source_reference text, source_authority text, detail text,
  recorded_at timestamptz, expires_at timestamptz, evidence_weight integer,
  supports_claim boolean, content_hash text
);
CREATE TABLE IF NOT EXISTS domain_registry_observation_history (
  domain_registry_id uuid NOT NULL REFERENCES domain_registry(id), observed_date date NOT NULL,
  observation_count bigint NOT NULL, distinct_app_count integer NOT NULL,
  first_observed_at timestamptz NOT NULL, last_observed_at timestamptz NOT NULL,
  PRIMARY KEY(domain_registry_id,observed_date)
);
ALTER TABLE metadata_observations
  ADD COLUMN IF NOT EXISTS source_app_name text,
  ADD COLUMN IF NOT EXISTS source_app_category text,
  ADD COLUMN IF NOT EXISTS attribution_method text,
  ADD COLUMN IF NOT EXISTS source_uid integer,
  ADD COLUMN IF NOT EXISTS attribution_failure_reason text,
  ADD COLUMN IF NOT EXISTS attribution_signals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attribution_lookup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shared_uid_package_count integer,
  ADD COLUMN IF NOT EXISTS app_signing_certificate_sha256 text,
  ADD COLUMN IF NOT EXISTS endpoint_signature_id text,
  ADD COLUMN IF NOT EXISTS endpoint_role text,
  ADD COLUMN IF NOT EXISTS endpoint_purpose text,
  ADD COLUMN IF NOT EXISTS endpoint_confidence integer,
  ADD COLUMN IF NOT EXISTS endpoint_evidence_source text,
  ADD COLUMN IF NOT EXISTS endpoint_registry_version text,
  ADD COLUMN IF NOT EXISTS app_installed_at timestamptz,
  ADD COLUMN IF NOT EXISTS app_last_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_system_app boolean,
  ADD COLUMN IF NOT EXISTS app_version_name text,
  ADD COLUMN IF NOT EXISTS app_version_code text,
  ADD COLUMN IF NOT EXISTS app_instance_id uuid REFERENCES app_instances(id),
  ADD COLUMN IF NOT EXISTS domain_registry_id uuid REFERENCES domain_registry(id);
CREATE TABLE IF NOT EXISTS behavior_baselines (
  device_id uuid NOT NULL REFERENCES devices(id), app_instance_id uuid NOT NULL REFERENCES app_instances(id),
  baseline_start timestamptz NOT NULL, baseline_end timestamptz NOT NULL,
  total_observations bigint NOT NULL, observed_days integer NOT NULL,
  maturity text NOT NULL, baseline_confidence integer NOT NULL,
  last_calculated_at timestamptz NOT NULL, algorithm_version text NOT NULL,
  PRIMARY KEY(device_id,app_instance_id)
);
CREATE TABLE IF NOT EXISTS behavior_baseline_daily (
  device_id uuid NOT NULL REFERENCES devices(id), app_instance_id uuid NOT NULL REFERENCES app_instances(id),
  observed_date date NOT NULL, observation_count bigint NOT NULL,
  PRIMARY KEY(device_id,app_instance_id,observed_date)
);
CREATE TABLE IF NOT EXISTS behavior_baseline_destinations (
  device_id uuid NOT NULL REFERENCES devices(id), app_instance_id uuid NOT NULL REFERENCES app_instances(id),
  destination_host text NOT NULL, domain_registry_id uuid REFERENCES domain_registry(id),
  first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, total_observations bigint NOT NULL,
  PRIMARY KEY(device_id,app_instance_id,destination_host)
);
CREATE TABLE IF NOT EXISTS behavior_baseline_hourly (
  device_id uuid NOT NULL REFERENCES devices(id), app_instance_id uuid NOT NULL REFERENCES app_instances(id),
  bucket_start timestamptz NOT NULL, observation_count bigint NOT NULL,
  bytes_bucket_counts jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(device_id,app_instance_id,bucket_start)
);
CREATE TABLE IF NOT EXISTS collection_events (
  id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), session_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('session_started','heartbeat','session_stopped','vpn_revoked','crash_detected')),
  occurred_at timestamptz NOT NULL, reason text, last_heartbeat_at timestamptz, app_version text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_events_device_time_idx ON collection_events(device_id,occurred_at,received_at);
CREATE INDEX IF NOT EXISTS metadata_batches_device_time_idx ON metadata_batches(device_id,received_at);
CREATE INDEX IF NOT EXISTS metadata_observations_batch_time_idx ON metadata_observations(batch_id,occurred_at);
REVOKE UPDATE,DELETE ON collection_events FROM PUBLIC;
COMMIT;
