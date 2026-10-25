import type { Pool, PoolClient } from 'pg';
import type { CollectorAuthorizationRequest, CollectorEvidence, CollectorEvidenceProvider } from './collector-authorization.js';

type Queryable = Pick<Pool, 'query'>;

export type PostgresEvidenceOptions = {
  /** CAIP-2 chain id a verification must be on (e.g. "eip155:137"). Empty => nothing can verify (deny). */
  requiredChain: string;
  /** Minimum independent RPC/indexer providers that must have agreed. */
  minProviderQuorum?: number;
  /** Verifier identity must differ from the stamper identity of the proof. */
  requireDistinctVerifier?: boolean;
};

/**
 * Reads authoritative evidence from PostgreSQL. It never trusts client input: all statuses come from rows
 * written by backend services. Absent rows map to MISSING/UNKNOWN, which the authorization service denies.
 * Any query failure propagates and is converted to BLOCKED_SERVICE_UNAVAILABLE by the service.
 */
export class PostgresCollectorEvidenceProvider implements CollectorEvidenceProvider {
  constructor(private readonly pool: Pool, private readonly options: PostgresEvidenceOptions) {}

  async withIngestionTransaction<T>(request: CollectorAuthorizationRequest, work: (transaction: unknown) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Same lock domain as consent grant/revoke writes and metadata ingestion.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`permission:${request.consentScope}`]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async loadEvidence(request: CollectorAuthorizationRequest, transaction?: unknown): Promise<CollectorEvidence | null> {
    const db: Queryable = (transaction as PoolClient | undefined) ?? this.pool;
    const lock = transaction ? ' FOR SHARE' : '';
    const device = await db.query<{ id: string; subject_id: string; revoked_at: Date | null; enrollment: string | null }>(
      `SELECT d.id, d.subject_id, d.revoked_at, e.status AS enrollment
         FROM devices d LEFT JOIN device_enrollments e ON e.device_id = d.id
        WHERE d.id = $1`, [request.deviceId]);
    const dev = device.rows[0];
    if (!dev) return null;

    const consent = await db.query<{ id: string; subject_id: string; action: string; purpose: string; policy_version: string; purpose_version: string }>(
      `SELECT id, subject_id, action, purpose, policy_version, purpose_version FROM consent_events
        WHERE permission_id = $1 ORDER BY event_sequence DESC LIMIT 1`, [request.consentScope]);
    const c = consent.rows[0];
    const epoch = await db.query<{ epoch: string }>(`SELECT epoch FROM revocation_epochs WHERE permission_id = $1${lock}`, [request.consentScope]);
    const policy = await db.query<{ policy_version: string; disclosure_version: string; verdict: string }>(
      'SELECT policy_version, disclosure_version, verdict FROM safety_policies ORDER BY created_at DESC, id DESC LIMIT 1');
    const attestation = await db.query<{ status: string; expires_at: Date }>(
      'SELECT status, expires_at FROM os_permission_attestations WHERE device_id = $1 ORDER BY attested_at DESC, id DESC LIMIT 1', [request.deviceId]);
    const receipt = c ? await db.query<{ id: string; decision_version: string; subject_id: string }>(
      'SELECT id, decision_version, subject_id FROM consent_receipts WHERE consent_event_id = $1', [c.id]) : { rows: [] };
    const r = receipt.rows[0];
    const verification = r ? await db.query<{ result: string; chain_id: string; finality_reached: boolean; provider_quorum: number; verifier_id: string; stamper: string }>(
      `SELECT v.result, v.chain_id, v.finality_reached, v.provider_quorum, v.verifier_id, p.submitted_by AS stamper
         FROM proof_verifications v JOIN chain_proofs p ON p.id = v.chain_proof_id
        WHERE v.receipt_id = $1 ORDER BY v.verified_at DESC, v.id DESC LIMIT 1`, [r.id]) : { rows: [] };
    const pending = r && verification.rows.length === 0 ? await db.query<{ status: string }>(
      "SELECT status FROM chain_proofs WHERE receipt_id = $1 AND status IN ('PENDING','SUBMITTED') LIMIT 1", [r.id]) : { rows: [] };
    const v = verification.rows[0];

    const minQuorum = Math.max(this.options.minProviderQuorum ?? 2, 1);
    const distinct = this.options.requireDistinctVerifier !== false;
    const verified = !!v && v.result === 'VERIFIED' && v.provider_quorum >= minQuorum && (!distinct || v.verifier_id !== v.stamper);
    const policyRow = policy.rows[0];
    const att = attestation.rows[0];
    const attFresh = !!att && att.expires_at.getTime() > Date.now();
    const epochValue = epoch.rows[0] ? Number(epoch.rows[0].epoch) : -1; // missing => deny (negative is invalid)
    const decision = (c?.action ?? '').toUpperCase();

    return {
      subjectValid: !!c && c.subject_id === dev.subject_id,
      deviceOwnerSubject: dev.subject_id,
      deviceEnrollment: dev.revoked_at ? 'REVOKED' : (['ACTIVE', 'PENDING', 'REVOKED'].includes(dev.enrollment ?? '') ? dev.enrollment as 'ACTIVE' | 'PENDING' | 'REVOKED' : 'UNKNOWN'),
      consentDecision: decision === 'GRANT' || decision === 'DENY' || decision === 'REVOKE' ? decision : 'UNKNOWN',
      consentScope: request.consentScope,
      consentPurpose: c?.purpose ?? '',
      policyVersion: c?.policy_version ?? '',
      currentPolicyVersion: policyRow?.policy_version ?? '',
      disclosureVersion: c?.purpose_version ?? '',
      currentDisclosureVersion: policyRow?.disclosure_version ?? '',
      decisionVersion: c?.id ?? '',
      receiptDecisionVersion: r?.decision_version ?? '',
      receiptStatus: r && c && r.decision_version === c.id && r.subject_id === c.subject_id ? 'IMMUTABLE' : r ? 'INVALID' : 'MISSING',
      proofStatus: verified ? 'INDEPENDENTLY_VERIFIED' : v ? 'FAILED' : pending.rows.length ? 'PENDING' : 'MISSING',
      proofChain: v?.chain_id ?? '',
      requiredChain: this.options.requiredChain,
      finalityReached: v?.finality_reached === true,
      osPermissionEvidence: att ? (att.status === 'SERVER_VERIFIED' && attFresh ? 'SERVER_VERIFIED' : 'INVALID') : 'MISSING',
      safetyPolicy: policyRow?.verdict === 'PASS' ? 'PASS' : policyRow?.verdict === 'FAIL' ? 'FAIL' : 'UNKNOWN',
      revoked: decision === 'REVOKE',
      expired: false,
      superseded: false,
      revocationEpoch: epochValue,
      // Without fresh attestation the OS-permission check denies; this bound only caps issued capability lifetime.
      expiresAt: attFresh ? att!.expires_at.getTime() : Date.now() + 60_000
    };
  }
}
