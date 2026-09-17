import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IntelligenceEngine } from './intelligence.js';
import { PermissionsEngine } from './permissions.js';
import { buildServer, memoryStore } from './server.js';

test('production permissions start with no implicit app or buyer authorization', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const permissions = new PermissionsEngine(new IntelligenceEngine());
    const userId = `subject-${randomUUID()}`;
    assert.deepEqual(permissions.getAppPermissions(userId), []);
    assert.deepEqual(permissions.getBuyerPermissions(userId), []);
    const metadata = permissions.getMetadataPermissions(userId, 'com.example.newapp');
    assert.equal(metadata.length, 7);
    assert.ok(metadata.every(item => item.state === 'blocked'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('explicit metadata authorization is separate from buyer authorization', () => {
  const permissions = new PermissionsEngine(new IntelligenceEngine(), { seedDemo: false });
  const userId = `subject-${randomUUID()}`;
  permissions.setMetadataPermissions(userId, 'com.example.shop', [{
    metadata_type: 'commercial',
    state: 'allowed',
    buyer_overrides: [],
    last_updated: new Date().toISOString()
  }], 'explicit_commercial_authorization');
  assert.equal(permissions.getMetadataPermissions(userId, 'com.example.shop').find(p => p.metadata_type === 'commercial')?.state, 'allowed');
  assert.deepEqual(permissions.getBuyerPermissions(userId), []);
});

test('collector monitoring consent remains independent and exact-purpose ingestion still works', async () => {
  const store = memoryStore();
  const app = buildServer({ store, adminSecret: 'm4-secret', permissionsEngine: new PermissionsEngine(undefined, { seedDemo: false }) });
  const subjectId = randomUUID();
  const device = await app.inject({ method: 'POST', url: '/v1/staging/devices', headers: { 'x-admin-secret': 'm4-secret' }, payload: { subjectId } });
  const token = device.json().token as string;
  const permissionId = randomUUID();
  const headers = { authorization: `Bearer ${token}` };
  const purpose = 'Detect unexpected data destinations';
  assert.equal((await app.inject({ method: 'POST', url: '/v1/consent-events', headers, payload: { permissionId, action: 'grant', policyVersion: 'privacy-1', purposeVersion: 'network-safety-1', purpose } })).statusCode, 202);
  const payload = { batchId: randomUUID(), schemaVersion: '2026-08-01', observations: [{ eventId: randomUUID(), occurredAt: new Date().toISOString(), sourceApp: 'com.example.moto', attribution: 'verified', destinationHost: 'api.example.com', protocol: 'tls', bytesBucket: '1-10KB', classification: 'expected', consentId: permissionId, consentPurpose: purpose }] };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload })).statusCode, 202);
  assert.equal(store.observations.length, 1);
  await app.close();
});
