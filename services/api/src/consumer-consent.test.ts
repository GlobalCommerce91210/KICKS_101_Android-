import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';

async function setup() {
  const store = memoryStore();
  const identity = new MemoryConsumerIdentityStore();
  const bindings = new MemoryConsumerDeviceBindingStore();
  const app = buildServer({ store, consumerIdentityStore: identity, consumerDeviceBindingStore: bindings, adminSecret: 'test-admin' });
  const subjectId = randomUUID();
  const device = await app.inject({ method: 'POST', url: '/v1/staging/devices', headers: { 'x-admin-secret': 'test-admin' }, payload: { subjectId } });
  assert.equal(device.statusCode, 201);
  const { deviceId, token } = device.json();
  const account = async (email: string) => {
    await identity.createAccount({ email, password: 'Synthetic-Test-Password-2026', terms_version: 'terms-1', privacy_version: 'privacy-1' });
    const login = await app.inject({ method: 'POST', url: '/core/identity/v1/session', payload: { email, password: 'Synthetic-Test-Password-2026' } });
    assert.equal(login.statusCode, 200);
    return { authorization: `Bearer ${login.json().access_token}` };
  };
  const owner = await account('consent-owner@example.test');
  const stranger = await account('consent-stranger@example.test');
  const binding = await app.inject({ method: 'POST', url: '/core/consumer/v1/devices', headers: owner, payload: { device_id: deviceId, device_binding_token: token, platform: 'ios' } });
  assert.equal(binding.statusCode, 201);
  const permissionId = randomUUID();
  const payload = { permissionId, activationRequestId: randomUUID(), action: 'grant', purpose: 'Detect unexpected data destinations', policyVersion: 'privacy-1', purposeVersion: 'network-safety-1' };
  const url = `/core/consumer/v1/devices/${deviceId}/consent`;
  return { app, store, identity, bindings, owner, stranger, subjectId, deviceId, token, permissionId, payload, url };
}

test('account grant uses collector ledger and revocation blocks further ingestion', async t => {
  const f = await setup(); t.after(() => f.app.close());
  const grant = await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: f.payload });
  assert.equal(grant.statusCode, 202);
  const event = await f.store.currentConsent(f.deviceId, f.subjectId, f.permissionId);
  assert.equal(event?.id, grant.json().id);
  assert.equal(event?.subjectId, f.subjectId);
  const collector = await f.store.findDeviceByTokenHash(createHash('sha256').update(f.token).digest('hex'));
  assert.equal(collector?.subjectId, f.subjectId);
  const batch = () => ({
    batchId: randomUUID(), schemaVersion: '2026-08-01',
    observations: [{ eventId: randomUUID(), occurredAt: new Date().toISOString(), sourceApp: 'com.example.app', attribution: 'verified', destinationHost: 'api.example.test', protocol: 'tls', bytesBucket: '1-10KB', classification: 'expected', consentId: grant.json().activationId, consentPurpose: f.payload.purpose }]
  });
  const collectorHeaders = { authorization: `Bearer ${f.token}` };
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: batch() })).statusCode, 202);
  const read = await f.app.inject({ method: 'GET', url: `${f.url}?permissionId=${f.permissionId}`, headers: f.owner });
  assert.equal(read.json().consent.action, 'grant');
  const revoke = await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: { ...f.payload, activationRequestId: randomUUID(), action: 'revoke' } });
  assert.equal(revoke.statusCode, 202);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: batch() })).statusCode, 403);
  assert.equal(f.store.observations.length, 1);
  assert.equal((await f.app.inject({ method: 'GET', url: `${f.url}?permissionId=${f.permissionId}`, headers: f.owner })).json().consent.action, 'revoke');
});

test('denies anonymous, collector-only, and other-account access', async t => {
  const f = await setup(); t.after(() => f.app.close());
  for (const [headers, expected] of [[{}, 401], [{ authorization: `Bearer ${f.token}` }, 401], [f.stranger, 404]] as const) {
    assert.equal((await f.app.inject({ method: 'POST', url: f.url, headers, payload: f.payload })).statusCode, expected);
    assert.equal((await f.app.inject({ method: 'GET', url: `${f.url}?permissionId=${f.permissionId}`, headers })).statusCode, expected);
  }
  assert.equal(f.store.consents.length, 0);
});

test('replays identical requests and rejects changed scope without appending', async t => {
  const f = await setup(); t.after(() => f.app.close());
  const original = await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: f.payload });
  const replay = await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: f.payload });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, original.json().id);
  assert.equal(f.store.consents.length, 1);
  assert.equal((await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: { ...f.payload, action: 'revoke' } })).statusCode, 409);
  assert.equal((await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: { ...f.payload, activationRequestId: randomUUID(), purpose: 'Commercial sharing' } })).statusCode, 409);
  assert.equal(f.store.consents.length, 1);
});

test('logout and revoked device binding stop account consent writes', async t => {
  const f = await setup(); t.after(() => f.app.close());
  await f.bindings.revoke((await f.identity.findSessionByAccessToken(f.owner.authorization.slice(7)))!.subject_id, f.deviceId);
  assert.equal((await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: f.payload })).statusCode, 404);
  await f.app.inject({ method: 'DELETE', url: '/core/identity/v1/session', headers: f.owner });
  assert.equal((await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: f.payload })).statusCode, 401);
  assert.equal(f.store.consents.length, 0);
});

test('rejects caller-supplied identity and invalid request fields', async t => {
  const f = await setup(); t.after(() => f.app.close());
  for (const payload of [{ ...f.payload, subjectId: randomUUID() }, { ...f.payload, activationRequestId: undefined }, { ...f.payload, permissionId: 'invalid' }]) {
    assert.equal((await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload })).statusCode, 422);
  }
  assert.equal(f.store.consents.length, 0);
});

test('service recreation reads decisions from the injected shared store', async t => {
  const f = await setup();
  await f.app.inject({ method: 'POST', url: f.url, headers: f.owner, payload: f.payload });
  await f.app.close();
  const restarted = buildServer({ store: f.store, consumerIdentityStore: f.identity, consumerDeviceBindingStore: f.bindings });
  t.after(() => restarted.close());
  const result = await restarted.inject({ method: 'GET', url: `${f.url}?permissionId=${f.permissionId}`, headers: f.owner });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().consent.action, 'grant');
});
