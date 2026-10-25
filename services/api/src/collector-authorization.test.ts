import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectorAuthorizationService, type CollectorAuthorizationRequest, type CollectorEvidence } from './collector-authorization.js';

const request: CollectorAuthorizationRequest = {
  authenticatedSubject: 'subject-1',
  deviceId: 'device-1',
  consentScope: 'permission-1',
  purpose: 'network safety metadata',
  requestedOperation: 'metadata.ingest'
};
const validEvidence = (): CollectorEvidence => ({
  subjectValid: true, deviceOwnerSubject: 'subject-1', deviceEnrollment: 'ACTIVE',
  consentDecision: 'GRANT', consentScope: 'permission-1', consentPurpose: 'network safety metadata',
  policyVersion: 'policy-3', currentPolicyVersion: 'policy-3',
  disclosureVersion: 'disclosure-2', currentDisclosureVersion: 'disclosure-2',
  decisionVersion: 'decision-9', receiptDecisionVersion: 'decision-9',
  receiptStatus: 'IMMUTABLE', proofStatus: 'INDEPENDENTLY_VERIFIED',
  proofChain: 'test-chain', requiredChain: 'test-chain', finalityReached: true,
  osPermissionEvidence: 'SERVER_VERIFIED', safetyPolicy: 'PASS',
  revoked: false, expired: false, superseded: false, revocationEpoch: 4,
  expiresAt: Date.now() + 120_000
});
const serviceWith = (read: () => CollectorEvidence | null) =>
  new CollectorAuthorizationService({ loadEvidence: async () => read() });

test('missing verifier/evidence provider denies authorization', async () => {
  const result = await new CollectorAuthorizationService(undefined).authorizeCollector(request);
  assert.equal(result.eligible, false);
  assert.equal(result.state, 'BLOCKED_SERVICE_UNAVAILABLE');
});

test('a current grant without independent blockchain proof is denied', async () => {
  const evidence = validEvidence(); evidence.proofStatus = 'MISSING';
  const result = await serviceWith(() => evidence).authorizeCollector(request);
  assert.equal(result.eligible, false);
  assert.equal(result.state, 'BLOCKED_VERIFICATION_FAILED');
});

test('pending proof is distinct from failed or missing proof', async () => {
  const evidence = validEvidence(); evidence.proofStatus = 'PENDING';
  const result = await serviceWith(() => evidence).authorizeCollector(request);
  assert.equal(result.state, 'BLOCKED_STAMP_PENDING');
});

test('each required evidence gate fails closed', async (t) => {
  const cases: Array<[string, (e: CollectorEvidence) => void, string]> = [
    ['invalid subject', e => { e.subjectValid = false; }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    ['wrong device owner', e => { e.deviceOwnerSubject = 'other'; }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    ['pending enrollment', e => { e.deviceEnrollment = 'PENDING'; }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    ['revoked device', e => { e.deviceEnrollment = 'REVOKED'; }, 'BLOCKED_REVOKED'],
    ['no current grant', e => { e.consentDecision = 'DENY'; }, 'BLOCKED_NO_CONSENT'],
    ['wrong scope', e => { e.consentScope = 'another-permission'; }, 'BLOCKED_NO_CONSENT'],
    ['wrong purpose', e => { e.consentPurpose = 'different purpose'; }, 'BLOCKED_NO_CONSENT'],
    ['stale policy', e => { e.currentPolicyVersion = 'new-policy'; }, 'BLOCKED_POLICY'],
    ['stale disclosure', e => { e.currentDisclosureVersion = 'new-disclosure'; }, 'BLOCKED_POLICY'],
    ['receipt not linked to current decision', e => { e.receiptDecisionVersion = 'old-decision'; }, 'BLOCKED_VERIFICATION_FAILED'],
    ['mutable or missing receipt', e => { e.receiptStatus = 'MISSING'; }, 'BLOCKED_VERIFICATION_FAILED'],
    ['failed blockchain proof', e => { e.proofStatus = 'FAILED'; }, 'BLOCKED_VERIFICATION_FAILED'],
    ['finality not reached', e => { e.finalityReached = false; }, 'BLOCKED_VERIFICATION_FAILED'],
    ['wrong proof chain', e => { e.proofChain = 'unapproved-chain'; }, 'BLOCKED_VERIFICATION_FAILED'],
    ['OS permission evidence missing', e => { e.osPermissionEvidence = 'MISSING'; }, 'BLOCKED_OS_PERMISSION'],
    ['safety policy failure', e => { e.safetyPolicy = 'FAIL'; }, 'BLOCKED_POLICY'],
    ['revoked authorization', e => { e.revoked = true; }, 'BLOCKED_REVOKED'],
    ['expired authorization', e => { e.expiresAt = Date.now() - 1; }, 'BLOCKED_REVOKED'],
    ['superseded decision', e => { e.superseded = true; }, 'BLOCKED_REVOKED'],
    ['unknown revocation epoch', e => { e.revocationEpoch = Number.NaN; }, 'BLOCKED_SERVICE_UNAVAILABLE'],
    ['unknown expiry', e => { e.expiresAt = Number.NaN; }, 'BLOCKED_SERVICE_UNAVAILABLE']
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async () => {
      const evidence = validEvidence(); mutate(evidence);
      const result = await serviceWith(() => evidence).authorizeCollector(request);
      assert.equal(result.eligible, false);
      assert.equal(result.state, expected);
    });
  }
});

test('successful test evidence creates a short-lived scoped capability', async () => {
  const result = await serviceWith(validEvidence).authorizeCollector(request);
  assert.equal(result.eligible, true);
  assert.equal(result.state, 'ELIGIBLE');
  assert.ok(result.authorizationId);
  assert.ok(Date.parse(result.expiresAt!) <= Date.now() + 60_000);
});

test('every capability validation re-reads evidence and rejects revocation', async () => {
  const evidence = validEvidence();
  const service = serviceWith(() => evidence);
  const issued = await service.authorizeCollector(request);
  assert.ok(issued.authorizationId);
  evidence.revoked = true;
  const result = await service.validateAuthorization(issued.authorizationId!, request);
  assert.equal(result.eligible, false);
  assert.equal(result.state, 'BLOCKED_REVOKED');
});

test('scope substitution cannot reuse an issued capability', async () => {
  const service = serviceWith(validEvidence);
  const issued = await service.authorizeCollector(request);
  assert.ok(issued.authorizationId);
  const result = await service.validateAuthorization(issued.authorizationId!, { ...request, requestedOperation: 'partner.export' });
  assert.equal(result.eligible, false);
  assert.equal(result.state, 'BLOCKED_POLICY');
});
