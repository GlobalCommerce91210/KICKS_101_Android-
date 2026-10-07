import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer } from './server.js';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { PostgresStore } from './store.js';
import { PostgresConsumerIdentityStore } from './consumer-identity-postgres.js';
import { PostgresConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import { SessionManager } from '../../../apps/mobile/services/sessionCore.js';

test('PostgreSQL retains mobile account, refresh session, collector binding, consent and accepted metadata across server restart', { skip: !process.env.KICKS_TEST_DATABASE_URL }, async t => {
  const schema = 'test_consent_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: process.env.KICKS_TEST_DATABASE_URL });
  await admin.query('CREATE SCHEMA ' + schema);
  const url = new URL(process.env.KICKS_TEST_DATABASE_URL!);
  url.searchParams.set('options', '-c search_path=' + schema);
  const createPool = () => new Pool({ connectionString: url.toString() });
  const setup = createPool();
  try {
    await setup.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../db/migrations/001-account-consent.sql', import.meta.url), 'utf8');
    await setup.query(migration);
    await setup.query(migration); // compatibility changes can be reapplied safely
    const collectorMigration = await readFile(new URL('../db/migrations/002-collector-metadata.sql', import.meta.url), 'utf8');
    await setup.query(collectorMigration);
    await setup.query(collectorMigration);
  } finally { await setup.end(); }
  let store: PostgresStore;
  let identity: PostgresConsumerIdentityStore;
  const openServer = () => {
    store = new PostgresStore(createPool());
    identity = new PostgresConsumerIdentityStore(createPool());
    return buildServer({ store, consumerIdentityStore: identity, consumerDeviceBindingStore: new PostgresConsumerDeviceBindingStore(createPool()), adminSecret: 'synthetic-admin' });
  };
  let app = openServer();
  t.after(async () => { await app.close(); await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); });
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
    body: JSON.stringify({ device_id: deviceId, device_binding_token: token, platform: 'android', display_name: 'Synthetic Android collector' })
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

  const batch = () => ({ batchId: randomUUID(), schemaVersion: '2026-08-01', observations: [{ eventId: randomUUID(), occurredAt: new Date().toISOString(), sourceApp: 'com.synthetic.app', attribution: 'verified', destinationHost: 'google-analytics.com', protocol: 'tls', bytesBucket: '1-10KB', classification: 'expected', consentId: activationId, consentPurpose: decision.purpose }] });
  const collectorHeaders = { authorization: 'Bearer ' + token };
  const acceptedBatch = batch();
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: acceptedBatch })).statusCode, 202);
  // Duplicate collector retries do not create another observation.
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: acceptedBatch })).statusCode, 409);
  await app.close();
  app = openServer();
  const restored = new SessionManager(storage, () => 'https://staging.example.test', transport);
  await restored.restore();
  assert.equal(restored.user?.subjectId, session.user?.subjectId);
  const read = await restored.request(consentPath + '?permissionId=' + permissionId);
  assert.equal((await read.json()).consent.action, 'grant');
  const snapshot = await store!.engineSnapshot(deviceId, collectorSubject, 10);
  assert.equal(snapshot.metrics.observations, 1);
  assert.ok(snapshot.observations[0]);
  assert.equal(snapshot.observations[0].destinationHost, 'google-analytics.com');
  assert.equal(snapshot.consent.status, 'active');
  const evidencePool = createPool();
  try {
    for (const table of ['app_instances', 'domain_registry', 'domain_registry_evidence', 'domain_registry_observation_history', 'behavior_baselines', 'behavior_baseline_daily', 'behavior_baseline_destinations', 'behavior_baseline_hourly']) {
      assert.ok(Number((await evidencePool.query('SELECT count(*) AS n FROM ' + table)).rows[0].n) > 0, table);
    }
  } finally { await evidencePool.end(); }
  assert.equal((await store!.currentConsent(deviceId, collectorSubject, permissionId))?.activationId, activationId);
  const persistedDevices = await restored.request('/core/consumer/v1/devices');
  assert.equal((await persistedDevices.json()).devices[0].device_id, deviceId);
  const revoke = await restored.request(consentPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...decision, activationRequestId: randomUUID(), action: 'revoke' }) });
  assert.equal(revoke.status, 202);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: collectorHeaders, payload: batch() })).statusCode, 403);
  assert.equal((await store!.currentConsent(deviceId, collectorSubject, permissionId))?.action, 'revoke');
  assert.equal((await store!.engineSnapshot(deviceId, collectorSubject, 10)).metrics.observations, 1);
  await restored.logout();
  assert.equal(saved, null);
  assert.ok(logoutToken);
  assert.equal(await identity!.findSessionByAccessToken(logoutToken!), null);
});
