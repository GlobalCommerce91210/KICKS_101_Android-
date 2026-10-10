import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';

const PASSWORD = 'A-Strong-Test-Password-2026';
const NEW_PASSWORD = 'A-New-Strong-Test-Password-2026';
const key = () => `idem-${randomUUID()}`;

async function createAccount(app: ReturnType<typeof buildServer>, email: string) {
  return app.inject({
    method: 'POST',
    url: '/core/identity/v1/account',
    headers: { 'idempotency-key': key() },
    payload: {
      email,
      password: PASSWORD,
      terms_version: 'terms-1',
      privacy_version: 'privacy-1',
    },
  });
}

async function login(app: ReturnType<typeof buildServer>, email: string, password = PASSWORD) {
  return app.inject({ method: 'POST', url: '/core/identity/v1/session', payload: { email, password } });
}

test('token email verification is one-use and activates the account', async () => {
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: new MemoryConsumerIdentityStore(),
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
  });
  const created = await createAccount(app, 'verify-lifecycle@example.com');
  assert.equal(created.statusCode, 201);
  const verificationToken = created.json().email_verification.debug_token;
  assert.equal(typeof verificationToken, 'string');

  const verified = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/email-verification/confirm',
    payload: { token: verificationToken },
  });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.json().account.email_verified, true);
  assert.equal(verified.json().account.account_status, 'active');

  const replay = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/email-verification/confirm',
    payload: { token: verificationToken },
  });
  assert.equal(replay.statusCode, 400);
  await app.close();
});

test('password reset is one-use, revokes existing sessions, and changes credentials', async () => {
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: new MemoryConsumerIdentityStore(),
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
  });
  await createAccount(app, 'reset-lifecycle@example.com');
  const initial = await login(app, 'reset-lifecycle@example.com');
  assert.equal(initial.statusCode, 200);
  const accessToken = initial.json().access_token;

  const request = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/password-reset/request',
    payload: { email: 'reset-lifecycle@example.com' },
  });
  assert.equal(request.statusCode, 202);
  const resetToken = request.json().debug_token;
  assert.equal(typeof resetToken, 'string');

  const reset = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/password-reset/confirm',
    payload: { token: resetToken, new_password: NEW_PASSWORD },
  });
  assert.equal(reset.statusCode, 204);

  const oldSession = await app.inject({
    method: 'GET',
    url: '/core/identity/v1/account',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(oldSession.statusCode, 401);
  assert.equal((await login(app, 'reset-lifecycle@example.com')).statusCode, 401);
  assert.equal((await login(app, 'reset-lifecycle@example.com', NEW_PASSWORD)).statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/password-reset/confirm',
    payload: { token: resetToken, new_password: PASSWORD },
  });
  assert.equal(replay.statusCode, 400);
  await app.close();
});

test('beta MFA uses a one-time email challenge and never returns a live pre-MFA session', async () => {
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: new MemoryConsumerIdentityStore(),
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
  });
  await createAccount(app, 'mfa-lifecycle@example.com');
  const initial = await login(app, 'mfa-lifecycle@example.com');
  assert.equal(initial.statusCode, 200);

  const enabled = await app.inject({
    method: 'PUT',
    url: '/core/identity/v1/mfa',
    headers: { authorization: `Bearer ${initial.json().access_token}` },
    payload: { enabled: true },
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.json().strategy, 'email_one_time_challenge');

  const challenged = await login(app, 'mfa-lifecycle@example.com');
  assert.equal(challenged.statusCode, 202);
  assert.equal(challenged.json().mfa_required, true);
  assert.equal(challenged.json().access_token, undefined);
  const challengeToken = challenged.json().debug_token;

  const complete = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session/mfa',
    payload: { token: challengeToken },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(typeof complete.json().access_token, 'string');

  const replay = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session/mfa',
    payload: { token: challengeToken },
  });
  assert.equal(replay.statusCode, 401);
  await app.close();
});

test('closed account revokes refresh, anonymizes identity, and preserves collector history', async () => {
  const collector = memoryStore();
  const identityStore = new MemoryConsumerIdentityStore();
  const app = buildServer({
    store: collector,
    consumerIdentityStore: identityStore,
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
    adminSecret: 'm2-secret',
  });

  const staged = await app.inject({
    method: 'POST',
    url: '/v1/staging/devices',
    headers: { 'x-admin-secret': 'm2-secret' },
    payload: { subjectId: randomUUID() },
  });
  assert.equal(staged.statusCode, 201);
  const before = { devices: collector.devices.size, observations: collector.observations.length };

  const created = await createAccount(app, 'delete-lifecycle@example.com');
  const subjectId = created.json().account.subject_id;
  const session = await login(app, 'delete-lifecycle@example.com');
  const refreshToken = session.json().refresh_token;

  const closed = await app.inject({
    method: 'DELETE',
    url: '/core/identity/v1/account',
    headers: { authorization: `Bearer ${session.json().access_token}` },
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json().data_consequences.collector_history, 'preserved');
  assert.deepEqual({ devices: collector.devices.size, observations: collector.observations.length }, before);

  const account = await identityStore.findAccountBySubjectId(subjectId);
  assert.equal(account?.account_status, 'closed');
  assert.equal(account?.marketing_opt_in, false);
  assert.deepEqual(account?.metadata, {});
  assert.match(account?.email ?? '', /^deleted\+/);

  const refresh = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session/refresh',
    payload: { refresh_token: refreshToken },
  });
  assert.equal(refresh.statusCode, 401);
  assert.equal((await login(app, 'delete-lifecycle@example.com')).statusCode, 401);
  await app.close();
});

test('suspended account cannot authenticate or refresh', async () => {
  const identityStore = new MemoryConsumerIdentityStore();
  const app = buildServer({
    store: memoryStore(),
    consumerIdentityStore: identityStore,
    consumerDeviceBindingStore: new MemoryConsumerDeviceBindingStore(),
  });
  const created = await createAccount(app, 'suspended-lifecycle@example.com');
  const subjectId = created.json().account.subject_id;
  const session = await login(app, 'suspended-lifecycle@example.com');
  assert.equal(session.statusCode, 200);

  const privateAccounts = (identityStore as unknown as { accounts: Map<string, { account_status: string }> }).accounts;
  const record = privateAccounts.get(subjectId);
  assert.ok(record);
  record.account_status = 'suspended';

  assert.equal((await login(app, 'suspended-lifecycle@example.com')).statusCode, 401);
  const refresh = await app.inject({
    method: 'POST',
    url: '/core/identity/v1/session/refresh',
    payload: { refresh_token: session.json().refresh_token },
  });
  assert.equal(refresh.statusCode, 401);
  await app.close();
});
