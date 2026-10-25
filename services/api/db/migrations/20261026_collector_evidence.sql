-- KICK-011C: authoritative evidence tables for CollectorAuthorizationService.
-- Every table is empty by default; with no rows the provider denies authorization (fail closed).
-- Rows are written only by backend services (stamper, independent verifier, attestation service, policy admin),
-- never from client-supplied "verified" flags.

CREATE OR REPLACE FUNCTION kicks_reject_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% on % is not permitted: append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = '23000'; END;
$$ LANGUAGE plpgsql;

-- Immutable receipt of one consent decision. receipt_hash is the only value anchored on-chain (never personal data).
CREATE TABLE IF NOT EXISTS consent_receipts (
  id uuid PRIMARY KEY,
  consent_event_id uuid NOT NULL UNIQUE REFERENCES consent_events(id),
  permission_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  decision_version text NOT NULL,
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_receipts_permission_idx ON consent_receipts(permission_id);

-- Anchoring attempt written by the stamper. Status here is NOT authorizing; only proof_verifications is.
CREATE TABLE IF NOT EXISTS chain_proofs (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES consent_receipts(id),
  chain_id text NOT NULL,                 -- CAIP-2, e.g. eip155:137
  tx_hash text,
  block_number bigint,
  merkle_root text,
  merkle_proof jsonb,
  status text NOT NULL CHECK (status IN ('PENDING','SUBMITTED','FAILED')),
  submitted_by text NOT NULL,             -- stamper identity
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chain_proofs_receipt_idx ON chain_proofs(receipt_id, created_at DESC);

-- Append-only log written only by the independent verifier (distinct identity from the stamper).
CREATE TABLE IF NOT EXISTS proof_verifications (
  id uuid PRIMARY KEY,
  chain_proof_id uuid NOT NULL REFERENCES chain_proofs(id),
  receipt_id uuid NOT NULL REFERENCES consent_receipts(id),
  verifier_id text NOT NULL,
  result text NOT NULL CHECK (result IN ('VERIFIED','FAILED')),
  chain_id text NOT NULL,
  finality_reached boolean NOT NULL,
  provider_quorum integer NOT NULL CHECK (provider_quorum >= 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proof_verifications_receipt_idx ON proof_verifications(receipt_id, verified_at DESC);

CREATE TABLE IF NOT EXISTS device_enrollments (
  device_id uuid PRIMARY KEY REFERENCES devices(id),
  subject_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server-verified OS permission evidence (e.g. Play Integrity verdict + VPN/notification grants verified server side).
CREATE TABLE IF NOT EXISTS os_permission_attestations (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id),
  status text NOT NULL CHECK (status IN ('SERVER_VERIFIED','INVALID')),
  verifier_id text NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS os_permission_attestations_device_idx ON os_permission_attestations(device_id, attested_at DESC);

-- Current policy/disclosure versions and collector safety verdict. The newest row is authoritative.
CREATE TABLE IF NOT EXISTS safety_policies (
  id uuid PRIMARY KEY,
  policy_version text NOT NULL,
  disclosure_version text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('PASS','FAIL')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Monotonic per-permission revocation epoch, bumped by trigger inside the consent-decision transaction.
CREATE TABLE IF NOT EXISTS revocation_epochs (
  permission_id uuid PRIMARY KEY,
  subject_id uuid NOT NULL,
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0)
);

CREATE OR REPLACE FUNCTION kicks_bump_revocation_epoch() RETURNS trigger AS $$
BEGIN
  INSERT INTO revocation_epochs (permission_id, subject_id, epoch) VALUES (NEW.permission_id, NEW.subject_id, 1)
  ON CONFLICT (permission_id) DO UPDATE SET epoch = revocation_epochs.epoch + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS consent_events_bump_epoch ON consent_events;
CREATE TRIGGER consent_events_bump_epoch AFTER INSERT ON consent_events
  FOR EACH ROW EXECUTE FUNCTION kicks_bump_revocation_epoch();

DROP TRIGGER IF EXISTS consent_receipts_immutable ON consent_receipts;
CREATE TRIGGER consent_receipts_immutable BEFORE UPDATE OR DELETE ON consent_receipts
  FOR EACH ROW EXECUTE FUNCTION kicks_reject_mutation();
DROP TRIGGER IF EXISTS proof_verifications_append_only ON proof_verifications;
CREATE TRIGGER proof_verifications_append_only BEFORE UPDATE OR DELETE ON proof_verifications
  FOR EACH ROW EXECUTE FUNCTION kicks_reject_mutation();
DROP TRIGGER IF EXISTS os_permission_attestations_append_only ON os_permission_attestations;
CREATE TRIGGER os_permission_attestations_append_only BEFORE UPDATE OR DELETE ON os_permission_attestations
  FOR EACH ROW EXECUTE FUNCTION kicks_reject_mutation();
DROP TRIGGER IF EXISTS safety_policies_append_only ON safety_policies;
CREATE TRIGGER safety_policies_append_only BEFORE UPDATE OR DELETE ON safety_policies
  FOR EACH ROW EXECUTE FUNCTION kicks_reject_mutation();
