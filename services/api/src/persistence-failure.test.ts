import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer } from './server.js';
import type { ConsentRepository } from './consent-repository.js';
import type { DeviceRepository } from './device-repository.js';

const subjectId = randomUUID();
const permissionId = randomUUID();
const consentInput = {
  permissionId,
  requestId: randomUUID(),
  action: 'grant' as const,
  policyVersion: 'privacy-test-1',
  purposeVersion: 'network-safety-test-1',
  purpose: 'Detect unexpected data destinations'
};
const deviceRepository = (overrides: Partial<DeviceRepository> = {}): DeviceRepository => ({
  create: async () => undefined,
  revokeByTokenHash: async () => true,\n  findActiveByTokenHash: async tokenHash => ({
    id: randomUUID(), subjectId, tokenHash, revoked: false
  }),
  ...overrides
});
const consentRepository = (overrides: Partial<ConsentRepository> = {}): ConsentRepository => ({
  recordDecision: async input => ({ ...input, id: randomUUID(), occurredAt: new Date().toISOString() }),
  getCurrent: async () => ({
    id: permissionId, subjectId, purpose: consentInput.purpose,
    policyVersion: consentInput.policyVersion, purposeVersion: consentInput.purposeVersion,
    state: 'granted'
  }),
  getHistory: async () => [],
  ...overrides
});
const enroll = async (app: ReturnType<typeof buildServer>) => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/staging/devices',
    headers: { 'x-admin-secret': 'failure-test-secret' },
    payload: { subjectId }
  });
  assert.equal(response.statusCode, 201);
  return { authorization: `Bearer ${response.json().token as string}` };
};

test('device authentication storage outage returns retryable 503', async () => {
  const app = buildServer({
    adminSecret: 'failure-test-secret',
    deviceRepository: deviceRepository({
      findActiveByTokenHash: async () => { throw new Error('simulated device database outage'); }
    })
  });
  try {
    const headers = await enroll(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/consent-events', headers, payload: consentInput
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.json().error, 'device_authentication_unavailable');
  } finally {
    await app.close();
  }
});

test('consent write outage returns retryable 503 without success response', async () => {
  const app = buildServer({
    adminSecret: 'failure-test-secret',
    deviceRepository: deviceRepository(),
    consentRepository: consentRepository({
      recordDecision: async () => { throw new Error('simulated consent write outage'); }
    })
  });
  try {
    const headers = await enroll(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/consent-events', headers, payload: consentInput
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.json().error, 'consent_persistence_unavailable');
    assert.equal(response.json().retryable, true);
  } finally {
    await app.close();
  }
});

test('consent history outage returns retryable 503', async () => {
  const app = buildServer({
    adminSecret: 'failure-test-secret',
    deviceRepository: deviceRepository(),
    consentRepository: consentRepository({
      getHistory: async () => { throw new Error('simulated consent read outage'); }
    })
  });
  try {
    const headers = await enroll(app);
    const response = await app.inject({
      method: 'GET', url: `/v1/consent-events/${permissionId}`, headers
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.json().error, 'consent_persistence_unavailable');
  } finally {
    await app.close();
  }
});

test('consent verification outage fails closed for metadata ingestion', async () => {
  const app = buildServer({
    adminSecret: 'failure-test-secret',
    deviceRepository: deviceRepository(),
    consentRepository: consentRepository({
      getCurrent: async () => { throw new Error('simulated consent verification outage'); }
    })
  });
  try {
    const headers = await enroll(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: randomUUID(),
        schemaVersion: '2026-08-01',
        observations: [{
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          sourceApp: 'com.example.test',
          attribution: 'verified',
          destinationHost: 'api.example.com',
          protocol: 'tls',
          bytesBucket: '1-10KB',
          classification: 'expected',
          consentId: permissionId,
          consentPurpose: consentInput.purpose
        }]
      }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.json().error, 'consent_verification_unavailable');
  } finally {
    await app.close();
  }
});


test('collector eligibility requires explicit activation and exact current purpose consent', async () => {
  const app = buildServer({
    adminSecret: 'failure-test-secret',
    deviceRepository: deviceRepository(),
    consentRepository: consentRepository()
  });
  try {
    const headers = await enroll(app);
    const missingActivation = await app.inject({
      method: 'POST',
      url: '/v1/collector/eligibility',
      headers,
      payload: { permissionId, purpose: consentInput.purpose, activationRequested: false }
    });
    assert.equal(missingActivation.statusCode, 400);

    const wrongPurpose = await app.inject({
      method: 'POST',
      url: '/v1/collector/eligibility',
      headers,
      payload: { permissionId, purpose: 'A different purpose', activationRequested: true }
    });
    assert.equal(wrongPurpose.statusCode, 403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/collector/eligibility',
      headers,
      payload: { permissionId, purpose: consentInput.purpose, activationRequested: true }
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().eligible, true);
    assert.equal(allowed.json().monitoringDefaultOn, false);
  } finally {
    await app.close();
  }
});


test('device revocation is persisted and prevents further authentication', async () => {
  let revoked = false;
  const repo = deviceRepository({
    findActiveByTokenHash: async tokenHash => revoked ? null : ({
      id: randomUUID(), subjectId, tokenHash, revoked: false
    }),
    revokeByTokenHash: async () => { revoked = true; return true; }
  });
  const app = buildServer({ adminSecret: 'failure-test-secret', deviceRepository: repo });
  try {
    const headers = await enroll(app);
    const before = await app.inject({
      method: 'GET', url: `/v1/consent-events/${permissionId}`, headers
    });
    assert.equal(before.statusCode, 200);
    const revoke = await app.inject({ method: 'POST', url: '/v1/devices/revoke', headers });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().revoked, true);
    const after = await app.inject({
      method: 'GET', url: `/v1/consent-events/${permissionId}`, headers
    });
    assert.equal(after.statusCode, 401);
  } finally {
    await app.close();
  }
});
