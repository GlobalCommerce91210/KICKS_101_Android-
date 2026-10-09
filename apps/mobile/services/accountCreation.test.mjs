import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from './sessionCore.ts';
const input = { email: ' Person@example.test ', password: 'test-only-password', termsVersion: 'staging-terms', privacyVersion: 'staging-privacy', idempotencyKey: 'test-only-request-0123456789' };
test('creation delegates to canonical DataStorm with policy receipt and retry key without establishing a session', async () => {
  const calls = []; let storageWrites = 0;
  const manager = new SessionManager({ read: async () => null, write: async () => { storageWrites++; }, clear: async () => {} }, () => 'https://staging.example.test', async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify({ account: { subject_id: 'ds-sub-a', email: 'person@example.test' } }), { status: 201 });
  });
  await manager.createAccount(input);
  assert.equal(calls[0].url, 'https://staging.example.test/core/identity/v1/account');
  assert.equal(calls[0].init.headers['idempotency-key'], input.idempotencyKey);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.terms_version, input.termsVersion); assert.equal(body.privacy_version, input.privacyVersion);
  assert.equal(body.marketing_opt_in, false);
  assert.equal(manager.user, null); assert.equal(storageWrites, 0);
});
test('unconfigured creation and malformed account replies fail safely', async () => {
  let calls = 0;
  const manager = new SessionManager({ read: async () => null, write: async () => {}, clear: async () => {} }, () => 'https://staging.example.test', async () => { calls++; return new Response(JSON.stringify({ account: { subject_id: 'ds-sub-b', email: 'other@example.test' } })); });
  await assert.rejects(manager.createAccount({ ...input, termsVersion: '' }), /not configured/); assert.equal(calls, 0);
  await assert.rejects(manager.createAccount(input), /could not be verified/); assert.equal(manager.user, null);
});
