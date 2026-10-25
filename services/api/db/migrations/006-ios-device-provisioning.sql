-- KICK-iOS-001: additive iOS provisioning ledger. Apply only after
-- consumer_accounts, consumer_device_bindings, and devices exist.
-- No device, owner, or consent record is deleted or reassigned.
CREATE TABLE IF NOT EXISTS ios_device_provisioning (
  request_id UUID PRIMARY KEY,
  account_subject_id TEXT NOT NULL REFERENCES consumer_accounts(subject_id),
  device_id UUID NOT NULL UNIQUE REFERENCES devices(id),
  public_key TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
