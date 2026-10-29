import { CollectorAuthorizationService } from './collector-authorization.js';
import type { CollectorAuthorizationRequest, CollectorEvidence } from './collector-authorization.js';

// Test-only simulated verifier. Never import from production code paths.
export const verifiedEvidence = (r: CollectorAuthorizationRequest, overrides: Partial<CollectorEvidence> = {}): CollectorEvidence => ({
  subjectValid: true, deviceOwnerSubject: r.authenticatedSubject, deviceEnrollment: 'ACTIVE', consentDecision: 'GRANT',
  consentScope: r.consentScope, consentPurpose: r.purpose, policyVersion: 'p1', currentPolicyVersion: 'p1',
  disclosureVersion: 'd1', currentDisclosureVersion: 'd1', decisionVersion: 'v1', receiptDecisionVersion: 'v1',
  receiptStatus: 'IMMUTABLE', proofStatus: 'INDEPENDENTLY_VERIFIED', proofChain: 'chain', requiredChain: 'chain',
  finalityReached: true, osPermissionEvidence: 'SERVER_VERIFIED', safetyPolicy: 'PASS', revoked: false, expired: false,
  superseded: false, revocationEpoch: 0, expiresAt: Date.now() + 600_000, ...overrides
});

export const simulatedAuth = (overrides: Partial<CollectorEvidence> = {}, now?: () => number) =>
  new CollectorAuthorizationService({ loadEvidence: async r => verifiedEvidence(r, overrides) }, 60_000, now);
