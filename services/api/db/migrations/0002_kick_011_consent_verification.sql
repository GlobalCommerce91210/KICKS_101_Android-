-- KICK-011 durable consent, receipt, stamping, verification, and authorization records.
-- Apply through the project's migration runner after reviewing role/grant policy.
BEGIN;

CREATE TABLE IF NOT EXISTS consent_decisions (
  decision_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id),
  consent_scope text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('GRANT','DENY','REVOKE')),
  policy_version text NOT NULL,
  disclosure_version text NOT NULL,
  decision_version bigint NOT NULL CHECK (decision_version > 0),
  server_timestamp timestamptz NOT NULL DEFAULT now(),
  previous_decision_id uuid REFERENCES consent_decisions(decision_id),
  authenticated_actor_id uuid NOT NULL,
  receipt_id uuid NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  UNIQUE (user_id, device_id, consent_scope, decision_version),
  UNIQUE (authenticated_actor_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS consent_decisions_latest_idx
  ON consent_decisions (user_id, device_id, consent_scope, decision_version DESC);

CREATE TABLE IF NOT EXISTS consent_receipts (
  receipt_id uuid PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES consent_decisions(decision_id),
  canonical_proof_hash text NOT NULL CHECK (canonical_proof_hash ~ '^[a-f0-9]{64}$'),
  hash_algorithm text NOT NULL CHECK (hash_algorithm = 'sha256'),
  signing_key_reference text,
  signature_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'PENDING_PROVIDER'
    CHECK (verification_status IN ('PENDING_PROVIDER','PENDING_STAMP','SUBMITTED','VERIFIED','FAILED','REORGED'))
);

CREATE TABLE IF NOT EXISTS consent_stamp_jobs (
  job_id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES consent_receipts(receipt_id),
  provider_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUBMITTED','FAILED','DEAD_LETTER','VERIFIED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  transaction_reference text,
  chain_identifier text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_stamp_jobs_due_idx
  ON consent_stamp_jobs (next_attempt_at, created_at)
  WHERE status IN ('PENDING','FAILED');

CREATE TABLE IF NOT EXISTS consent_stamp_verifications (
  verification_id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES consent_receipts(receipt_id),
  chain_identifier text NOT NULL,
  transaction_reference text NOT NULL,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  verification_result text NOT NULL CHECK (verification_result IN ('VERIFIED','FAILED','PENDING','REORGED')),
  finality_evidence jsonb,
  verifier_version text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_identifier, transaction_reference, verifier_version)
);
CREATE INDEX IF NOT EXISTS consent_stamp_verifications_receipt_idx
  ON consent_stamp_verifications (receipt_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collector_authorizations (
  authorization_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id),
  consent_scope text NOT NULL,
  decision_version bigint NOT NULL,
  stamp_verification_id uuid NOT NULL REFERENCES consent_stamp_verifications(verification_id),
  enrollment_status text NOT NULL,
  permission_status text NOT NULL,
  policy_status text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  invalidated_reason text,
  CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS collector_authorizations_active_idx
  ON collector_authorizations (device_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS consent_decision_audit (
  audit_id uuid PRIMARY KEY,
  decision_id uuid NOT NULL REFERENCES consent_decisions(decision_id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Append-only protections for the decision/evidence history. Runtime roles should
-- receive INSERT/SELECT only; migrations/admin roles manage schema separately.
REVOKE UPDATE, DELETE ON consent_decisions, consent_receipts,
  consent_stamp_verifications, consent_decision_audit FROM PUBLIC;

COMMIT;
