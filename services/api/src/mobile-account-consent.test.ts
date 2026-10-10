import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import { SessionManager } from '../../../apps/mobile/services/sessionCore.js';

test('mobile session uses actual DataStorm routes and governs collector consent through account bindings', async t => {
  const store = memoryStore();
  const identity = new MemoryConsumerIdentityStore();
  const bindings = new MemoryConsumerDeviceBindingStore();
  const app = buildServer({ store, consumerIdentityStore: identity, consumerDeviceBindingStore: bindings, adminSecret: 'synthetic-admin' });
  t.after(() => app.close());
  let saved: string | null = null;
  let logoutToken: string | null = null;
  const storage = { async read() { return saved; }, async write(value: string) { saved = value; }, async clear() { saved = null; } };
  const transport: typeof fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://staging.example.test');
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    if (init.method === 'DELETE') logoutToken = headers.authorization?.slice(7) ?? null;
    const result = await app.inject({
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'DELETE',
      url: parsed.pathname + parsed.search,
      headers,
      payload: typeof init.body === 'string' ? init.body : undefined,
    });
    return new Response(result.statusCode === 204 ? null : result.body, {
      status: result.statusCode,
      headers: { 'content-type': String(result.headers['content-type'] ?? 'application/json') }
    });
  };
  const account = await app.inject({
    method: 'POST', url: '/core/identity/v1/account',
    headers: { 'idempotency-key': randomUUID() },
    payload: { email: 'wire-contract@example.test', password: 'Synthetic-Password-2026', terms_version: 'terms-1', privacy_version: 'privacy-1' }
  });
  assert.equal(account.statusCode, 201);
  const session = new SessionManager(storage, () => 'https://staging.example.test', transport);
  await session.login('wire-contract@example.test', 'Synthetic-Password-2026');
  assert.equal(session.user?.subjectId, account.json().account.subject_id);
  assert.ok(saved && !String(saved).includes('Synthetic-Password-2026'));
  const collectorSubject = randomUUID();
  const device = await app.inject({ method: 'POST', url: '/v1/staging/devices', headers: { 'x-admin-secret': 'synthetic-admin' }, payload: { subjectId: collectorSubject } });
  assert.equal(device.statusCode, 201);
  const { deviceId, token } = device.json();
  const bind = await session.request('/core/consumer/v1/devices', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, device_binding_token: token, platform: 'ios', display_name: 'Synthetic iPad' })
  });
  assert.equal(bind.status, 201);
  const devices = await session.request('/core/consumer/v1/devices');
  assert.equal((await devices.json()).devices.length, 1);
  const permissionId = randomUUID();
  const decision = { permissionId, activationRequestId: randomUUID(), action: 'grant', policyVersion: 'privacy-1', purposeVersion: 'network-safety-1', purpose: 'Detect unexpected data destinations' };
  const consentPath = '/core/consumer/v1/devices/' + deviceId + '/consent';
  const grant = await session.request(consentPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(decision) });
  assert.equal(grant.status, 202);
  const activationId = (await grant.json()).activationId;
  const restored = new SessionManager(storage, () => 'https://staging.example.test', transport);
  await restored.restore();
  assert.equal(restored.user?.subjectId, session.user?.subjectId);
  const read = await restored.request(consentPath + '?permissionId=' + permissionId);
  assert.equal((await read.json()).consent.action, 'grant');
  const batch = () => ({ batchId: randomUUID(), schemaVersion: '2026-08-01', observations: [{ eventId: randomUUID(), occurredAt: new Date().toISOString(), sourceApp: 'com.synthetic.app', attribution: 'verified', destinationHost: 'api.example.test', protocol: 'tls', bytesBucket: '1-10KB', classification: 'expected', consentId: activationId, consentPurpose: decision.purpose }] });
  const collectorHeaders = { authorization: 'Bearer ' + token };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: batch() })).statusCode, 202);
  const revoke = await restored.request(consentPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...decision, activationRequestId: randomUUID(), action: 'revoke' }) });
  assert.equal(revoke.status, 202);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: batch() })).statusCode, 403);
  assert.equal(store.observations.length, 1);
  assert.equal((await store.currentConsent(deviceId, collectorSubject, permissionId))?.action, 'revoke');
  await restored.logout();
  assert.equal(saved, null);
  assert.ok(logoutToken);
  assert.equal(await identity.findSessionByAccessToken(logoutToken!), null);
});
