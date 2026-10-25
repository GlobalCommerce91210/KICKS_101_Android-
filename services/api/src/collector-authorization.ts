import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type CollectorOperation = 'metadata.ingest' | 'intelligence.ingest' | 'queue.process' | 'partner.export';
export type CollectorEligibility =
  | 'BLOCKED_NO_CONSENT'
  | 'BLOCKED_STAMP_PENDING'
  | 'BLOCKED_VERIFICATION_FAILED'
  | 'BLOCKED_DEVICE_NOT_ENROLLED'
  | 'BLOCKED_OS_PERMISSION'
  | 'BLOCKED_REVOKED'
  | 'BLOCKED_POLICY'
  | 'BLOCKED_SERVICE_UNAVAILABLE'
  | 'ELIGIBLE';

export type CollectorAuthorizationRequest = {
  authenticatedSubject: string;
  deviceId: string;
  consentScope: string;
  purpose: string;
  requestedOperation: CollectorOperation;
};

export type CollectorEvidence = {
  subjectValid: boolean;
  deviceOwnerSubject: string;
  deviceEnrollment: 'ACTIVE' | 'PENDING' | 'REVOKED' | 'UNKNOWN';
  consentDecision: 'GRANT' | 'DENY' | 'REVOKE' | 'UNKNOWN';
  consentScope: string;
  consentPurpose: string;
  policyVersion: string;
  currentPolicyVersion: string;
  disclosureVersion: string;
  currentDisclosureVersion: string;
  decisionVersion: string;
  receiptDecisionVersion: string;
  receiptStatus: 'IMMUTABLE' | 'MISSING' | 'INVALID' | 'UNKNOWN';
  proofStatus: 'INDEPENDENTLY_VERIFIED' | 'PENDING' | 'FAILED' | 'MISSING' | 'UNKNOWN';
  proofChain: string;
  requiredChain: string;
  finalityReached: boolean;
  osPermissionEvidence: 'SERVER_VERIFIED' | 'MISSING' | 'INVALID' | 'UNKNOWN';
  safetyPolicy: 'PASS' | 'FAIL' | 'UNKNOWN';
  revoked: boolean;
  expired: boolean;
  superseded: boolean;
  revocationEpoch: number;
  expiresAt: number;
};

export interface CollectorEvidenceProvider {
  /** Must read authoritative backend evidence; never consume client "verified" flags. */
  loadEvidence(request: CollectorAuthorizationRequest, transaction?: unknown): Promise<CollectorEvidence | null>;
  /** Must be called in the same DB transaction/lock domain as ingestion commits. */
  withIngestionTransaction?<T>(request: CollectorAuthorizationRequest, work: (transaction: unknown) => Promise<T>): Promise<T>;
}

export type CollectorAuthorizationResult = {
  eligible: boolean;
  state: CollectorEligibility;
  reason: string;
  authorizationId?: string;
  expiresAt?: string;
  decisionVersion?: string;
};

type IssuedAuthorization = {
  tokenHash: string;
  request: CollectorAuthorizationRequest;
  decisionVersion: string;
  revocationEpoch: number;
  expiresAt: number;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secureEqual = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Shared fail-closed authorization boundary. No provider means no grant is possible.
 * Issued opaque capabilities are short-lived and device/scope/operation-bound.
 * Validation re-reads authoritative evidence on every use; TTL is not a revocation mechanism.
 */
export class CollectorAuthorizationService {
  private readonly issued = new Map<string, IssuedAuthorization>();
  constructor(
    private readonly provider: CollectorEvidenceProvider | undefined,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  async authorizeCollector(request: CollectorAuthorizationRequest, transaction?: unknown): Promise<CollectorAuthorizationResult> {
    if (!this.provider) return this.block('BLOCKED_SERVICE_UNAVAILABLE', 'authoritative_evidence_provider_missing');
    if (!request.authenticatedSubject || !request.deviceId || !request.consentScope || !request.purpose) {
      return this.block('BLOCKED_POLICY', 'required_authorization_context_missing');
    }
    let evidence: CollectorEvidence | null;
    try { evidence = await this.provider.loadEvidence(request, transaction); }
    catch { return this.block('BLOCKED_SERVICE_UNAVAILABLE', 'authoritative_evidence_unavailable'); }
    if (!evidence) return this.block('BLOCKED_SERVICE_UNAVAILABLE', 'authoritative_evidence_missing');
    if (evidence.revoked || evidence.deviceEnrollment === 'REVOKED') return this.block('BLOCKED_REVOKED', 'authorization_revoked');
    if (evidence.expired || evidence.superseded || evidence.expiresAt <= this.now()) return this.block('BLOCKED_REVOKED', 'authorization_expired_or_superseded');
    if (!evidence.subjectValid || evidence.deviceOwnerSubject !== request.authenticatedSubject ||
        evidence.deviceEnrollment !== 'ACTIVE') return this.block('BLOCKED_DEVICE_NOT_ENROLLED', 'subject_or_device_enrollment_invalid');
    if (evidence.consentDecision !== 'GRANT') return this.block('BLOCKED_NO_CONSENT', 'current_consent_is_not_grant');
    if (evidence.consentScope !== request.consentScope || evidence.consentPurpose !== request.purpose) return this.block('BLOCKED_NO_CONSENT', 'consent_scope_or_purpose_mismatch');
    if (!evidence.policyVersion || evidence.policyVersion !== evidence.currentPolicyVersion ||
        !evidence.disclosureVersion || evidence.disclosureVersion !== evidence.currentDisclosureVersion) return this.block('BLOCKED_POLICY', 'policy_or_disclosure_version_stale');
    if (!evidence.decisionVersion || evidence.receiptDecisionVersion !== evidence.decisionVersion) return this.block('BLOCKED_VERIFICATION_FAILED', 'receipt_not_linked_to_current_decision');
    if (evidence.receiptStatus !== 'IMMUTABLE') return this.block('BLOCKED_VERIFICATION_FAILED', 'immutable_receipt_not_verified');
    if (evidence.proofStatus === 'PENDING') return this.block('BLOCKED_STAMP_PENDING', 'blockchain_proof_pending');
    if (evidence.proofStatus !== 'INDEPENDENTLY_VERIFIED' || !evidence.finalityReached ||
        !evidence.proofChain || evidence.proofChain !== evidence.requiredChain) return this.block('BLOCKED_VERIFICATION_FAILED', 'independent_chain_proof_or_finality_missing');
    if (evidence.osPermissionEvidence !== 'SERVER_VERIFIED') return this.block('BLOCKED_OS_PERMISSION', 'server_verified_os_permission_evidence_missing');
    if (evidence.safetyPolicy !== 'PASS') return this.block('BLOCKED_POLICY', 'collector_safety_policy_not_passed');
    if (!Number.isSafeInteger(evidence.revocationEpoch) || evidence.revocationEpoch < 0) return this.block('BLOCKED_SERVICE_UNAVAILABLE', 'revocation_epoch_unavailable');

    const expiresAt = Math.min(this.now() + this.ttlMs, evidence.expiresAt);
    if (expiresAt <= this.now()) return this.block('BLOCKED_REVOKED', 'authorization_expired');
    const authorizationId = randomBytes(32).toString('base64url');
    this.issued.set(hash(authorizationId), {
      tokenHash: hash(authorizationId), request: { ...request },
      decisionVersion: evidence.decisionVersion, revocationEpoch: evidence.revocationEpoch, expiresAt
    });
    return { eligible: true, state: 'ELIGIBLE', reason: 'all_authoritative_checks_passed', authorizationId, expiresAt: new Date(expiresAt).toISOString(), decisionVersion: evidence.decisionVersion };
  }

  async validateAuthorization(token: string, request: CollectorAuthorizationRequest, transaction?: unknown): Promise<CollectorAuthorizationResult> {
    if (!token) return this.block('BLOCKED_SERVICE_UNAVAILABLE', 'authorization_capability_missing');
    const record = this.issued.get(hash(token));
    if (!record || !secureEqual(record.tokenHash, hash(token))) return this.block('BLOCKED_SERVICE_UNAVAILABLE', 'authorization_capability_invalid');
    if (record.expiresAt <= this.now()) { this.issued.delete(hash(token)); return this.block('BLOCKED_REVOKED', 'authorization_capability_expired'); }
    if (JSON.stringify(record.request) !== JSON.stringify(request)) return this.block('BLOCKED_POLICY', 'authorization_capability_scope_mismatch');
    // Re-read revocation, consent, proof, permissions and policy for every protected operation.
    const current = await this.authorizeCollector(request, transaction);
    if (!current.eligible || current.decisionVersion !== record.decisionVersion) {
      this.issued.delete(hash(token));
      return current.eligible ? this.block('BLOCKED_REVOKED', 'consent_version_changed') : current;
    }
    return current;
  }

  revokeAllForDevice(deviceId: string): void {
    for (const [key, value] of this.issued) if (value.request.deviceId === deviceId) this.issued.delete(key);
  }

  private block(state: Exclude<CollectorEligibility, 'ELIGIBLE'>, reason: string): CollectorAuthorizationResult {
    return { eligible: false, state, reason };
  }
}
