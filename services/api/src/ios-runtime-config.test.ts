import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIosGatewayRuntime } from './ios-runtime-config.js';
import { createIdentityTokenNotifier } from './identity-token-delivery.js';
import { buildServer } from './server.js';
import { randomUUID } from 'node:crypto';

const env = {
  KICKS_IOS_GATEWAY_ENABLED: 'true', DATABASE_URL: 'postgres://synthetic',
  KICKS_IOS_GATEWAY_HOST: 'gateway.example.test', KICKS_IOS_GATEWAY_PORT: '51820',
  KICKS_IOS_GATEWAY_PUBLIC_KEY: Buffer.alloc(32, 7).toString('base64'),
  KICKS_IOS_GATEWAY_AUTHORITY_SECRET: 'separate-synthetic-authority-secret-2026',
  KICKS_MONITORING_PERMISSION_ID: randomUUID(), KICKS_MONITORING_PURPOSE: 'Synthetic reviewed purpose',
  KICKS_MONITORING_PURPOSE_VERSION: 'synthetic-v1', KICKS_MONITORING_POLICY_VERSION: 'synthetic-privacy-v1',
};
test('gateway configuration requires durable staging and complete explicit reviewed policy', () => {
  assert.equal(resolveIosGatewayRuntime({}, 'staging'), null);
  assert.throws(() => resolveIosGatewayRuntime(env, 'production'), /durable staging/);
  assert.throws(() => resolveIosGatewayRuntime({...env, DATABASE_URL: ''}, 'staging'), /durable staging/);
  for (const key of Object.keys(env).filter(k => k !== 'DATABASE_URL' && k !== 'KICKS_IOS_GATEWAY_ENABLED')) {
    assert.throws(() => resolveIosGatewayRuntime({...env, [key]: ''}, 'staging'));
  }
  assert.throws(() => resolveIosGatewayRuntime({...env, KICKS_STAGING_ADMIN_SECRET: env.KICKS_IOS_GATEWAY_AUTHORITY_SECRET}, 'staging'), /separate secret/);
  assert.equal(resolveIosGatewayRuntime(env, 'staging')?.permissionId, env.KICKS_MONITORING_PERMISSION_ID);
});
test('delivery refuses redirects and unsafe config; failures disclose no token or credential', async () => {
  assert.equal(createIdentityTokenNotifier({}), undefined);
  assert.throws(() => createIdentityTokenNotifier({KICKS_IDENTITY_DELIVERY_URL: 'http://example.test', KICKS_IDENTITY_DELIVERY_SECRET: 'x'.repeat(32)}), /HTTPS/);
  let request: RequestInit | undefined;
  const notify = createIdentityTokenNotifier({KICKS_IDENTITY_DELIVERY_URL: 'https://delivery.example.test', KICKS_IDENTITY_DELIVERY_SECRET: 'x'.repeat(32)},
    (async (_url, init) => { request = init; return new Response('', {status: 502}); }) as typeof fetch)!;
  await assert.rejects(async () => notify({subject_id: 'synthetic', email: 'synthetic@example.test', kind: 'email_verification', token: 'PRIVATE_SYNTHETIC_TOKEN'}), /^Error: identity_token_delivery_failed$/);
  assert.equal(request?.redirect, 'error');
});
test('launcher delivers registration verification and confirmation permits account login; health reports unavailable gateway', async t => {
  const deliveries: { token: string }[] = [];
  const app = buildServer({ identityTokenNotifier: async delivery => { deliveries.push(delivery); } });
  t.after(() => app.close());
  const registration = await app.inject({method: 'POST', url: '/core/identity/v1/account', headers: {'idempotency-key': randomUUID()},
    payload: {email: 'delivered@example.test', password: 'Synthetic-Password-2026', terms_version: 'synthetic-v1', privacy_version: 'synthetic-v1'}});
  assert.equal(registration.statusCode, 201);
  assert.equal(deliveries.length, 1);
  assert.equal((await app.inject({method: 'POST', url: '/core/identity/v1/email-verification/confirm', payload: {token: deliveries[0]!.token}})).statusCode, 200);
  const login = await app.inject({method:'POST', url:'/core/identity/v1/session', payload:{email:'delivered@example.test',password:'Synthetic-Password-2026'}});
  assert.equal(login.statusCode, 200);
  const health = (await app.inject({url:'/health'})).json();
  assert.equal(health.onboarding.emailDeliveryConfigured, true);
  assert.equal(health.onboarding.iosGatewayConfigured, false);
  assert.equal(health.onboarding.collectionVerified, false);
  assert.equal((await app.inject({url:'/core/consumer/v1/monitoring-policy'})).statusCode, 401);
  assert.equal((await app.inject({url:'/core/consumer/v1/monitoring-policy',headers:{authorization:'Bearer '+login.json().access_token}})).statusCode, 503);
});

test('missing delivery outside tests cannot create an account or silently accept a verification request', async t => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const app = buildServer();
  t.after(async () => { await app.close(); if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; });
  const response = await app.inject({method:'POST',url:'/core/identity/v1/account',headers:{'idempotency-key':randomUUID()},
    payload:{email:'undelivered@example.test',password:'Synthetic-Password-2026',terms_version:'synthetic-v1',privacy_version:'synthetic-v1'}});
  assert.equal(response.statusCode,503);
  assert.equal(response.json().error,'identity_delivery_unavailable');
  assert.equal((await app.inject({method:'POST',url:'/core/identity/v1/email-verification/request',payload:{email:'undelivered@example.test'}})).statusCode,503);
});
