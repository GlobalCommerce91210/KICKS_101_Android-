import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';

const idempotencyKey = () => `idem-${randomUUID()}`;

test('DataStorm creates master account, KICKS entitlement, and KICKS profile with zero implicit permissions', async () => {
  const identityStore = new MemoryConsumerIdentityStore();
  const deviceBindingStore = new MemoryConsumerDeviceBindingStore();
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: identityStore,
    consumerDeviceBindingStore: deviceBindingStore,
    adminSecret: 'staging-secret',
  });

  const create = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: {
      'idempotency-key': idempotencyKey(),
    },
    payload: {
      email: 'consumer@example.com',
      password: 'A-Strong-Test-Password-2026',
      region: 'US-GA',
      marketing_opt_in: false,
      terms_version: 'terms-1',
      privacy_version: 'privacy-1',
      metadata: {
        locale: 'en-US',
        timezone: 'America/New_York',
      },
    },
  });

  assert.equal(create.statusCode, 201);

  const body = create.json();

  assert.match(body.account.subject_id, /^ds_sub_/);
  assert.equal(body.account.email, 'consumer@example.com');
  assert.equal(body.account.account_status, 'pending_verification');
  assert.equal(body.account.email_verified, false);
  assert.equal(body.account.password_hash, undefined);

  assert.equal(body.product_access.kicks.product, 'kicks');
  assert.equal(body.product_access.kicks.status, 'active');
  assert.equal(
    body.kicks_profile.subject_id,
    body.account.subject_id,
  );
  assert.equal(
    body.kicks_profile.entitlement_id,
    body.product_access.kicks.entitlement_id,
  );

  assert.deepEqual(body.permissions, {
    monitoring: 'not_authorized',
    commercial_data: 'not_authorized',
    marketplace: 'not_authorized',
    compensated_opportunities: 'not_authorized',
  });

  await app.close();
});

test('DataStorm account creation is idempotent and rejects key reuse with changed payload', async () => {
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: new MemoryConsumerIdentityStore(),
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
  });

  const key = idempotencyKey();
  const payload = {
    email: 'idempotent@example.com',
    password: 'A-Strong-Test-Password-2026',
    terms_version: 'terms-1',
    privacy_version: 'privacy-1',
  };

  const first = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: { 'idempotency-key': key },
    payload,
  });

  const second = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: { 'idempotency-key': key },
    payload,
  });

  const conflict = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: { 'idempotency-key': key },
    payload: {
      ...payload,
      email: 'different@example.com',
    },
  });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(
    second.json().account.subject_id,
    first.json().account.subject_id,
  );
  assert.equal(conflict.statusCode, 409);

  await app.close();
});

test('consumer session authenticates DataStorm identity and gates KICKS profile access', async () => {
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: new MemoryConsumerIdentityStore(),
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
  });

  await app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: {
      'idempotency-key': idempotencyKey(),
    },
    payload: {
      email: 'session@example.com',
      password: 'A-Strong-Test-Password-2026',
      terms_version: 'terms-1',
      privacy_version: 'privacy-1',
    },
  });

  const unauthenticated = await app.inject({
    method: 'GET',
    url: '/core/consumer/v1/profile',
  });

  assert.equal(unauthenticated.statusCode, 401);

  const session = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session',
    payload: {
      email: 'session@example.com',
      password: 'A-Strong-Test-Password-2026',
    },
  });

  assert.equal(session.statusCode, 200);

  const tokens = session.json();

  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.product_access.kicks, true);
  assert.equal(typeof tokens.access_token, 'string');
  assert.equal(typeof tokens.refresh_token, 'string');

  const profile = await app.inject({
    method: 'GET',
    url: '/core/consumer/v1/profile',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
    },
  });

  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().entitlement.product, 'kicks');
  assert.equal(
    profile.json().profile.subject_id,
    profile.json().account.subject_id,
  );

  const refreshed = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session/refresh',
    payload: {
      refresh_token: tokens.refresh_token,
    },
  });

  assert.equal(refreshed.statusCode, 200);
  assert.notEqual(
    refreshed.json().access_token,
    tokens.access_token,
  );

  const oldSession = await app.inject({
    method: 'GET',
    url: '/core/consumer/v1/profile',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
    },
  });

  assert.equal(oldSession.statusCode, 401);

  await app.close();
});

test('KICKS binds an existing collector device without rewriting collector identity and exposes it through Snapshot', async () => {
  const collectorStore = memoryStore();
  const identityStore = new MemoryConsumerIdentityStore();
  const deviceBindingStore = new MemoryConsumerDeviceBindingStore();

  const app = buildServer({
    store: collectorStore,
    consumerIdentityStore: identityStore,
    consumerDeviceBindingStore: deviceBindingStore,
    adminSecret: 'staging-secret',
  });

  const collectorSubjectId = randomUUID();

  const stagedDevice = await app.inject({
    method: 'POST',
    url: '/v1/staging/devices',
    headers: {
      'x-admin-secret': 'staging-secret',
    },
    payload: {
      subjectId: collectorSubjectId,
    },
  });

  assert.equal(stagedDevice.statusCode, 201);

  const collectorDeviceId = stagedDevice.json().deviceId;
  const collectorToken = stagedDevice.json().token;

  const account = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: {
      'idempotency-key': idempotencyKey(),
    },
    payload: {
      email: 'device-owner@example.com',
      password: 'A-Strong-Test-Password-2026',
      terms_version: 'terms-1',
      privacy_version: 'privacy-1',
    },
  });

  assert.equal(account.statusCode, 201);

  const dataStormSubjectId = account.json().account.subject_id;

  assert.notEqual(dataStormSubjectId, collectorSubjectId);

  const session = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session',
    payload: {
      email: 'device-owner@example.com',
      password: 'A-Strong-Test-Password-2026',
    },
  });

  const accessToken = session.json().access_token;

  const bind = await app.inject({
    method: 'POST',
    url: '/core/consumer/v1/devices',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    payload: {
      device_id: collectorDeviceId,
      device_binding_token: collectorToken,
      display_name: 'Moto G',
      platform: 'android',
      app_version: '0.2.6',
    },
  });

  assert.equal(bind.statusCode, 201);
  assert.equal(bind.json().subject_id, dataStormSubjectId);
  assert.equal(
    bind.json().collector_subject_id,
    collectorSubjectId,
  );

  const originalCollectorDevice =
    await collectorStore.findDeviceByTokenHash(
      (await import('node:crypto'))
        .createHash('sha256')
        .update(collectorToken)
        .digest('hex'),
    );

  assert.ok(originalCollectorDevice);
  assert.equal(
    originalCollectorDevice.subjectId,
    collectorSubjectId,
  );

  const devices = await app.inject({
    method: 'GET',
    url: '/core/consumer/v1/devices',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  assert.equal(devices.statusCode, 200);
  assert.equal(devices.json().devices.length, 1);
  assert.equal(
    devices.json().devices[0].device_id,
    collectorDeviceId,
  );

  const snapshot = await app.inject({
    method: 'GET',
    url: '/core/consumer/v1/snapshot',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.json().consumer.subject_id, dataStormSubjectId);
  assert.equal(snapshot.json().devices.connected, 1);
  assert.notEqual(
    snapshot.json().sources.collector.status,
    'not_configured',
  );

  await app.close();
});
