import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { CollectorAuthorizationService } from './collector-authorization.js';
import { PostgresCollectorEvidenceProvider } from './collector-evidence-provider.js';

const SUBJECT = 'subject-1';
const DEVICE = 'device-1';
const PERMISSION = 'permission-1';
const PURPOSE = 'Detect unexpected data destinations';
const CHAIN = 'eip155:31337';

type QueryRow = Record<string, unknown>;
type RowOverrides = {
  device?: Partial<QueryRow>;
  epoch?: Partial<QueryRow>;
  receipt?: Partial<QueryRow>;
  verification?: Partial<QueryRow>;
};

function fakePool(overrides: RowOverrides = {}): Pool {
  const rows = {
    device: { id: DEVICE, subject_id: SUBJECT, revoked_at: null, enrollment: 'ACTIVE', enrollment_subject_id: SUBJECT, ...overrides.device },
    consent: { id: 'decision-1', subject_id: SUBJECT, action: 'grant', purpose: PURPOSE, policy_version: 'policy-1', purpose_version: 'purpose-1' },
    epoch: { epoch: '4', subject_id: SUBJECT, ...overrides.epoch },
    policy: { policy_version: 'policy-1', disclosure_version: 'purpose-1', verdict: 'PASS' },
    attestation: { status: 'SERVER_VERIFIED', expires_at: new Date(Date.now() + 60 * 60 * 1000) },
    receipt: { id: 'receipt-1', permission_id: PERMISSION, decision_version: 'decision-1', subject_id: SUBJECT, ...overrides.receipt },
    verification: {
      result: 'VERIFIED',
      receipt_id: 'receipt-1',
      chain_id: CHAIN,
      proof_chain_id: CHAIN,
      finality_reached: true,
      provider_quorum: 2,
      verifier_id: 'verifier-1',
      stamper: 'stamper-1',
      proof_receipt_id: 'receipt-1',
      ...overrides.verification
    }
  };

  const pool = {
    query: async <T extends QueryRow = QueryRow>(sql: string) => {
      const normalized = sql.toLowerCase();
      const row = normalized.includes('from devices') ? rows.device
        : normalized.includes('from consent_events') ? rows.consent
        : normalized.includes('from revocation_epochs') ? rows.epoch
        : normalized.includes('from safety_policies') ? rows.policy
        : normalized.includes('from os_permission_attestations') ? rows.attestation
        : normalized.includes('from consent_receipts') ? rows.receipt
        : normalized.includes('from proof_verifications') ? rows.verification
        : normalized.includes('from chain_proofs') ? undefined
        : undefined;
      return { rows: row ? [row as T] : [] };
    }
  };
  return pool as unknown as Pool;
}

function request() {
  return {
    authenticatedSubject: SUBJECT,
    deviceId: DEVICE,
    consentScope: PERMISSION,
    purpose: PURPOSE,
    requestedOperation: 'metadata.ingest' as const
  };
}

async function denied(overrides: RowOverrides) {
  const provider = new PostgresCollectorEvidenceProvider(fakePool(overrides), { requiredChain: CHAIN });
  return new CollectorAuthorizationService(provider).authorizeCollector(request());
}

test('simulated linkage guards deny an enrollment subject mismatch', async () => {
  const result = await denied({ epoch: { subject_id: SUBJECT }, device: { enrollment_subject_id: 'subject-other' } });
  assert.deepEqual({ state: result.state, reason: result.reason }, {
    state: 'BLOCKED_DEVICE_NOT_ENROLLED',
    reason: 'subject_or_device_enrollment_invalid'
  });
});

test('simulated linkage guards deny a revocation epoch subject mismatch', async () => {
  const result = await denied({ epoch: { subject_id: 'subject-other' } });
  assert.deepEqual({ state: result.state, reason: result.reason }, {
    state: 'BLOCKED_SERVICE_UNAVAILABLE',
    reason: 'revocation_epoch_unavailable'
  });
});

test('simulated linkage guards deny a receipt permission mismatch', async () => {
  const result = await denied({ receipt: { permission_id: 'permission-other' } });
  assert.deepEqual({ state: result.state, reason: result.reason }, {
    state: 'BLOCKED_VERIFICATION_FAILED',
    reason: 'immutable_receipt_not_verified'
  });
});

test('simulated linkage guards deny a verifier receipt different from the proof receipt', async () => {
  const result = await denied({ verification: { receipt_id: 'receipt-other' } });
  assert.deepEqual({ state: result.state, reason: result.reason }, {
    state: 'BLOCKED_VERIFICATION_FAILED',
    reason: 'independent_chain_proof_or_finality_missing'
  });
});

test('simulated linkage guards deny a verifier proof-chain mismatch', async () => {
  const result = await denied({ verification: { proof_chain_id: 'eip155:1' } });
  assert.deepEqual({ state: result.state, reason: result.reason }, {
    state: 'BLOCKED_VERIFICATION_FAILED',
    reason: 'independent_chain_proof_or_finality_missing'
  });
});

// These are simulated query rows only; they do not establish PostgreSQL persistence, constraints, or SQL acceptance.
