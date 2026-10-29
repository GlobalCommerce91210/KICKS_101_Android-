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
  return { app, store, headers, permissionId };
}

test('eligibility is informational and ingestion reauthorizes separately', async () => {
  const { app, store, headers, permissionId } = await setup();

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
  assert.equal(store.observations.length, 0);

  await app.close();
});
