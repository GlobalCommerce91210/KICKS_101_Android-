import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import type { CollectorVerificationRequest, CollectorVerifier } from './server.js';

test('metadata ingestion rejects mismatched consent subject, purpose, or versions', async () => {
  const store = memoryStore();
  const verificationRequests: CollectorVerificationRequest[] = [];
  const app = buildServer({
    store,
    adminSecret: 'metadata-test-secret',
    collectorVerifier: {
      verify: async request => {
        verificationRequests.push(request);
        return true;
      }
    }
  });
  const subjectId = randomUUID();
  try {
    const enrollment = await app.inject({
      method: 'POST',
      url: '/v1/staging/devices',
      headers: { 'x-admin-secret': 'metadata-test-secret' },
      payload: { subjectId }
    });
    assert.equal(enrollment.statusCode, 201);
    const headers = { authorization: 'Bearer ' + (enrollment.json().token as string) };
    const permissionId = randomUUID();
    const purpose = 'Detect unexpected data destinations';
    const policyVersion = 'privacy-1';
    const purposeVersion = 'network-safety-1';
    const grant = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId: randomUUID(),
        action: 'grant',
        policyVersion,
        purposeVersion,
        purpose
      }
    });
    assert.equal(grant.statusCode, 202);

    const baseObservation = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      sourceApp: 'com.example.test',
      attribution: 'verified',
      destinationHost: 'api.example.com',
      protocol: 'tls',
      bytesBucket: '1-10KB',
      classification: 'expected',
      consentId: permissionId,
      consentPurpose: purpose,
      consentPolicyVersion: policyVersion,
      consentPurposeVersion: purposeVersion
    };
    const send = (observation: typeof baseObservation, batchId = randomUUID()) => app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId,
        schemaVersion: '2026-10-25',
        observations: [observation]
      }
    });

    assert.equal((await send({
      ...baseObservation,
      eventId: randomUUID(),
      consentPolicyVersion: 'stale-policy'
    })).statusCode, 403);
    assert.equal((await send({
      ...baseObservation,
      eventId: randomUUID(),
      consentPurposeVersion: 'stale-purpose-version'
    })).statusCode, 403);
    assert.equal((await send({
      ...baseObservation,
      eventId: randomUUID(),
      consentPurpose: 'Different purpose'
    })).statusCode, 403);

    const otherSubjectPermission = randomUUID();
    store.consents.set(otherSubjectPermission, {
      id: otherSubjectPermission,
      subjectId: randomUUID(),
      purpose,
      policyVersion,
      purposeVersion,
      state: 'granted'
    });
    assert.equal((await send({
      ...baseObservation,
      eventId: randomUUID(),
      consentId: otherSubjectPermission
    })).statusCode, 403);

    assert.equal(store.observations.length, 0);
    const acceptedEventId = randomUUID();
    const acceptedBatchId = randomUUID();
    assert.equal((await send({ ...baseObservation, eventId: acceptedEventId }, acceptedBatchId)).statusCode, 202);
    assert.equal(store.observations.length, 1);
    const verified = verificationRequests[verificationRequests.length - 1];
    assert.ok(verified);
    assert.equal(verified.deviceId, enrollment.json().deviceId);
    assert.equal(verified.subjectId, subjectId);
    assert.equal(verified.batchId, acceptedBatchId);
    assert.equal(verified.permissionId, permissionId);
    assert.equal(verified.purpose, purpose);
    assert.equal(verified.policyVersion, policyVersion);
    assert.equal(verified.purposeVersion, purposeVersion);
    assert.deepEqual(verified.observationIds, [acceptedEventId]);
    assert.deepEqual(verified.verificationRequirements, {
      currentCollectorIdentityAndState: true,
      currentOsPermission: true,
      explicitActivation: true
    });
  } finally {
    await app.close();
  }
});

test('unsupported metadata schema version returns 400 without writes', async () => {
  const store = memoryStore();
  let verifierCalls = 0;
  const app = buildServer({
    store,
    adminSecret: 'metadata-test-secret',
    collectorVerifier: {
      verify: async () => {
        verifierCalls += 1;
        return true;
      }
    }
  });
  try {
    const subjectId = randomUUID();
    const enrollment = await app.inject({
      method: 'POST',
      url: '/v1/staging/devices',
      headers: { 'x-admin-secret': 'metadata-test-secret' },
      payload: { subjectId }
    });
    const permissionId = randomUUID();
    const purpose = 'Detect unexpected data destinations';
    const policyVersion = 'privacy-1';
    const purposeVersion = 'network-safety-1';
    const headers = { authorization: 'Bearer ' + (enrollment.json().token as string) };
    const grant = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId: randomUUID(),
        action: 'grant',
        policyVersion,
        purposeVersion,
        purpose
      }
    });
    assert.equal(grant.statusCode, 202);
    assert.deepEqual(store.consents.get(permissionId), {
      id: permissionId,
      subjectId,
      purpose,
      policyVersion,
      purposeVersion,
      state: 'granted'
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: randomUUID(),
        schemaVersion: 'unsupported',
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
          consentPurpose: purpose,
          consentPolicyVersion: policyVersion,
          consentPurposeVersion: purposeVersion
        }]
      }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(store.batches.size, 0);
    assert.equal(store.observations.length, 0);
    assert.equal(verifierCalls, 0);
  } finally {
    await app.close();
  }
});

test('missing, rejected, and unavailable collector verification never writes metadata', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const cases: Array<{
      name: string;
      verifier?: CollectorVerifier;
      statusCode: number;
      error: string;
    }> = [
      {
        name: 'missing',
        statusCode: 503,
        error: 'collector_verification_unavailable'
      },
      {
        name: 'rejected',
        verifier: { verify: async () => false },
        statusCode: 403,
        error: 'collector_verification_failed'
      },
      {
        name: 'unavailable',
        verifier: { verify: async () => { throw new Error('attestation service offline'); } },
        statusCode: 503,
        error: 'collector_verification_unavailable'
      }
    ];

    for (const current of cases) {
      const store = memoryStore();
      const app = buildServer({
        store,
        adminSecret: 'metadata-test-secret',
        ...(current.verifier ? { collectorVerifier: current.verifier } : {})
      });
      try {
        const subjectId = randomUUID();
        const enrollment = await app.inject({
          method: 'POST',
          url: '/v1/staging/devices',
          headers: { 'x-admin-secret': 'metadata-test-secret' },
          payload: { subjectId }
        });
        const permissionId = randomUUID();
        const purpose = 'Detect unexpected data destinations';
        const policyVersion = 'privacy-1';
        const purposeVersion = 'network-safety-1';
        const headers = { authorization: 'Bearer ' + (enrollment.json().token as string) };
        const grant = await app.inject({
          method: 'POST',
          url: '/v1/consent-events',
          headers,
          payload: {
            permissionId,
            requestId: randomUUID(),
            action: 'grant',
            policyVersion,
            purposeVersion,
            purpose
          }
        });
        assert.equal(grant.statusCode, 202, current.name);
        assert.deepEqual(store.consents.get(permissionId), {
          id: permissionId,
          subjectId,
          purpose,
          policyVersion,
          purposeVersion,
          state: 'granted'
        });
        const response = await app.inject({
          method: 'POST',
          url: '/v1/metadata-batches',
          headers,
          payload: {
            batchId: randomUUID(),
            schemaVersion: '2026-10-25',
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
              consentPurpose: purpose,
              consentPolicyVersion: policyVersion,
              consentPurposeVersion: purposeVersion
            }]
          }
        });
        assert.equal(response.statusCode, current.statusCode, current.name);
        assert.equal(response.json().error, current.error, current.name);
        assert.equal(store.batches.size, 0, current.name);
        assert.equal(store.observations.length, 0, current.name);
      } finally {
        await app.close();
      }
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
