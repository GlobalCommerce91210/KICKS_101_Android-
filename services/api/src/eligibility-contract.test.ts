import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';

const purpose = 'Detect unexpected data destinations';

async function setup() {
  const store = memoryStore();
  const app = buildServer({ store, adminSecret: 'staging-secret' });
  const subjectId = randomUUID();
  const device = await app.inject({
    method: 'POST',
    url: '/v1/staging/devices',
    headers: { 'x-admin-secret': 'staging-secret' },
    payload: { subjectId }
  });
  assert.equal(device.statusCode, 201);
  const token = device.json().token as string;
  const permissionId = randomUUID();
  const headers = { authorization: `Bearer ${token}` };
  const grant = await app.inject({
    method: 'POST',
    url: '/v1/consent-events',
    headers,
    payload: {
      permissionId,
      requestId: randomUUID(),
      action: 'grant',
      policyVersion: 'privacy-1',
      purposeVersion: 'network-safety-1',
      purpose
    }
  });
  assert.equal(grant.statusCode, 202);
  const grantBody = grant.json();
  return { app, store, headers, permissionId, decisionId: grantBody.id as string, decisionVersion: String(grantBody.eventSequence) };
}

test('eligibility is informational and ingestion reauthorizes separately', async () => {
  const { app, store, headers, permissionId, decisionId, decisionVersion } = await setup();

  const eligibility = await app.inject({
    method: 'POST',
    url: '/v1/collector/eligibility',
    headers,
    payload: { permissionId, purpose, activationRequested: true }
  });
  assert.equal(eligibility.statusCode, 200);
  const eligibilityBody = eligibility.json();
  assert.equal(eligibilityBody.eligible, true);
  assert.equal(eligibilityBody.state, 'ELIGIBLE');
  assert.equal(eligibilityBody.permissionId, permissionId);
  assert.equal(eligibilityBody.purpose, purpose);
  assert.equal(eligibilityBody.activationRequested, true);
  assert.equal(eligibilityBody.monitoringDefaultOn, false);
  assert.equal(eligibilityBody.decisionId, decisionId);
  assert.equal(eligibilityBody.decisionVersion, decisionVersion);
  assert.equal(eligibilityBody.policyVersion, 'privacy-1');
  assert.equal(eligibilityBody.purposeVersion, 'network-safety-1');
  assert.deepEqual(Object.keys(eligibilityBody).sort(), [
    'activationRequested', 'decisionId', 'decisionVersion', 'deviceId', 'eligible', 'monitoringDefaultOn',
    'permissionId', 'policyVersion', 'purpose', 'purposeVersion', 'state'
  ]);
  assert.equal('expiresAt' in eligibilityBody, false);

  const extraField = await app.inject({
    method: 'POST',
    url: '/v1/collector/eligibility',
    headers,
    payload: { permissionId, purpose, activationRequested: true, study: 'not-accepted' }
  });
  assert.equal(extraField.statusCode, 400);

  const oldGet = await app.inject({
    method: 'GET',
    url: `/v1/collector/eligibility?permissionId=${permissionId}&purpose=${encodeURIComponent(purpose)}`,
    headers
  });
  assert.equal(oldGet.statusCode, 404);

  const batch = {
    batchId: randomUUID(),
    schemaVersion: '2026-08-01',
    observations: [{
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      sourceApp: 'com.example.app',
      attribution: 'verified',
      destinationHost: 'api.example.com',
      protocol: 'tls',
      bytesBucket: '1-10KB',
      classification: 'expected',
      consentId: permissionId,
      consentPurpose: purpose
    }]
  };
  const ingestion = await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: batch });
  assert.equal(ingestion.statusCode, 503);
  assert.deepEqual(ingestion.json(), { error: 'collector_authorization_unavailable', state: 'BLOCKED_SERVICE_UNAVAILABLE', eligible: false });
  assert.equal(store.collectorAudit.length, 1);
  assert.equal(store.collectorAudit[0]!.state, 'BLOCKED_SERVICE_UNAVAILABLE');
  assert.equal(store.collectorAudit[0]!.reason, 'authoritative_evidence_provider_missing');
  assert.equal(store.observations.length, 0);

  await app.close();
});

test('eligibility denies without a current consent record and emits no version/reference fields', async () => {
  const store = memoryStore();
  const app = buildServer({ store, adminSecret: 'staging-secret' });
  const subjectId = randomUUID();
  const device = await app.inject({
    method: 'POST',
    url: '/v1/staging/devices',
    headers: { 'x-admin-secret': 'staging-secret' },
    payload: { subjectId }
  });
  assert.equal(device.statusCode, 201);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/collector/eligibility',
    headers: { authorization: `Bearer ${device.json().token as string}` },
    payload: { permissionId: randomUUID(), purpose, activationRequested: true }
  });
  assert.equal(response.statusCode, 403);
  const body = response.json();
  assert.deepEqual(body, { eligible: false, error: 'active_purpose_consent_required' });
  for (const field of ['decisionId', 'decisionVersion', 'policyVersion', 'purposeVersion']) {
    assert.equal(field in body, false);
  }
  await app.close();
});

test('buildServer registers the wallet earn route once and preserves wallet behavior', async () => {
  const app = buildServer();
  const eventId = 'evt-kick-011a-wallet-route';
  const response = await app.inject({
    method: 'POST',
    url: '/v1/wallet/events/earn',
    payload: { event_id: eventId, user_id: 'user_demo_01' }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ledger_entry.event_id, eventId);
  await app.close();
});
