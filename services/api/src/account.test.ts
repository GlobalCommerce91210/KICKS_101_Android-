import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer } from './server.js';
import { AccountProviderError, type DataStormAccountProvider, type AccountSession, type AccountResource } from './account.js';

const fixture = () => {
  const a = { account_id: 'account-a', consumer_id: 'consumer-a', display_name: 'Staging A', email: 'a@example.test', account_status: 'active' as const, profile_status: 'active' };
  const b = { ...a, account_id: 'account-b', consumer_id: 'consumer-b', email: 'b@example.test' };
  const sessions = new Map<string, AccountSession>();
  const tokens = ['human-session-token-a-0123456789', 'human-session-token-b-0123456789'];
  tokens.forEach((token, i) => sessions.set(token, { token, account: i === 0 ? a : b, expires_at: new Date(Date.now() + 60_000).toISOString() }));
  let mismatch = false, outage = false, malformed = false;
  const resources: Record<AccountResource, object> = {
    'consumer-state': { profile_status: 'active' }, snapshot: { membership_status: 'beta' },
    devices: { devices: [{ device_id: 'phone-a', label: 'Phone', status: 'connected' }, { device_id: 'tablet-a', label: 'Tablet', status: 'revoked' }] },
    permissions: { active_count: 1, revoked_count: 1 }, consent: { active_count: 1, revoked_count: 1 },
    monitoring: { status: 'off' }, wallet: { currency: 'USD', available_balance: 0, pending_balance: 0 }
  };
  const provider: DataStormAccountProvider = {
    async authenticate(_mode, credentials) { if (credentials.password !== 'test-only-password') throw new AccountProviderError(401, 'invalid_credentials'); return sessions.get(tokens[credentials.email === b.email ? 1 : 0]!)!; },
    async restore(token) { if (outage) throw new Error('private provider diagnostic'); return sessions.get(token) ?? null; },
    async logout(token) { sessions.delete(token); }, async recover() {},
    async resource(session, resource) { return { consumer_id: mismatch ? b.consumer_id : session.account.consumer_id, ...(malformed ? {} : resources[resource]) }; },
    async controls() { return { security: 'https://account.example.test/security', consent: 'https://account.example.test/consent', export: 'https://account.example.test/export', close: 'https://account.example.test/close' }; }
  };
  return { app: buildServer({ accountProvider: provider, adminSecret: 'test-secret' }), provider, sessions, tokens, a, b, mismatch: () => { mismatch = true; }, outage: () => { outage = true; }, malformed: () => { malformed = true; } };
};
test('account flow fails closed without canonical provider', async () => {
  const app = buildServer();
  for (const url of ['/core/identity/v1/account', '/core/consumer/v1/snapshot', '/v1/me/wallet']) assert.equal((await app.inject({ url })).statusCode, 503);
  await app.close();
});
test('native login and create return canonical identity, without a KICKS user store', async () => {
  const f = fixture();
  for (const mode of ['login', 'create']) {
    const r = await f.app.inject({ method: 'POST', url: `/core/identity/v1/session/${mode}`, payload: { email: f.a.email, password: 'test-only-password' } });
    assert.equal(r.statusCode, 200); assert.deepEqual(r.json().account, f.a); assert.equal(r.json().token, f.tokens[0]);
  }
  await f.app.close();
});
test('web session uses Secure HttpOnly SameSite cookie without exposing token in JSON', async () => {
  const f = fixture(), r = await f.app.inject({ method: 'POST', url: '/core/identity/v1/session/login', headers: { 'x-datastorm-client': 'web', host: 'app.example.test', origin: 'https://app.example.test' }, payload: { email: f.a.email, password: 'test-only-password' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().token, undefined);
  const cookie = String(r.headers['set-cookie']); assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
  const restored = await f.app.inject({ url: '/core/identity/v1/account', headers: { cookie: cookie.split(';')[0]! } });
  assert.equal(restored.statusCode, 200); assert.equal(restored.json().account.consumer_id, f.a.consumer_id);
  await f.app.close();
});
test('collector bearer tokens cannot authenticate a human account', async () => {
  const f = fixture(), device = await f.app.inject({ method: 'POST', url: '/v1/staging/devices', headers: { 'x-admin-secret': 'test-secret' }, payload: { subjectId: randomUUID() } });
  const r = await f.app.inject({ url: '/core/identity/v1/account', headers: { authorization: `Bearer ${device.json().token}` } });
  assert.equal(r.statusCode, 401); await f.app.close();
});
test('consumer resources hydrate only the authenticated consumer and reject client identity overrides', async () => {
  const f = fixture();
  for (const url of ['/v1/me/consumer-state', '/core/consumer/v1/snapshot', '/core/consumer/v1/devices', '/v1/me/permissions', '/v1/me/consent', '/v1/me/monitoring', '/v1/me/wallet']) {
    for (const i of [0, 1]) {
      const r = await f.app.inject({ url, headers: { authorization: `Bearer ${f.tokens[i]}` } });
      assert.equal(r.statusCode, 200); assert.equal(r.json().consumer_id, i === 0 ? f.a.consumer_id : f.b.consumer_id);
    }
    assert.equal((await f.app.inject({ url: `${url}?consumer_id=consumer-b`, headers: { authorization: `Bearer ${f.tokens[0]}` } })).statusCode, 403);
  }
  await f.app.close();
});
test('mismatched resource identity is rejected rather than rendered as another account', async () => {
  const f = fixture(); f.mismatch(); const r = await f.app.inject({ url: '/v1/me/wallet', headers: { authorization: `Bearer ${f.tokens[0]}` } });
  assert.equal(r.statusCode, 503); assert.equal(r.json().error, 'consumer_identity_mismatch'); await f.app.close();
});
test('malformed consumer resources cannot become empty-success profile state', async () => {
  const f = fixture(); f.malformed(); assert.equal((await f.app.inject({ url: '/core/consumer/v1/devices', headers: { authorization: `Bearer ${f.tokens[0]}` } })).statusCode, 503); await f.app.close();
});
test('expiry and logout prevent session restoration; logout clears web cookie', async () => {
  const f = fixture(); f.sessions.get(f.tokens[0]!)!.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await f.app.inject({ url: '/core/identity/v1/account', headers: { authorization: `Bearer ${f.tokens[0]}` } })).statusCode, 401);
  const r = await f.app.inject({ method: 'POST', url: '/core/identity/v1/session/logout', headers: { authorization: `Bearer ${f.tokens[1]}` } });
  assert.equal(r.statusCode, 204); assert.match(String(r.headers['set-cookie']), /Max-Age=0/);
  assert.equal((await f.app.inject({ url: '/core/identity/v1/account', headers: { authorization: `Bearer ${f.tokens[1]}` } })).statusCode, 401); await f.app.close();
});
test('provider outage exposes safe error without private diagnostics or demo account fallback', async () => {
  const f = fixture(); f.outage(); const r = await f.app.inject({ url: '/core/identity/v1/account', headers: { authorization: `Bearer ${f.tokens[0]}` } });
  assert.equal(r.statusCode, 503); assert.deepEqual(r.json(), { error: 'account_service_unavailable' }); await f.app.close();
});
test('browser mutation rejects cross-origin requests', async () => {
  const f = fixture(), r = await f.app.inject({ method: 'POST', url: '/core/identity/v1/session/logout', headers: { origin: 'https://attacker.example.test', host: 'app.example.test' } });
  assert.equal(r.statusCode, 403); await f.app.close();
});
test('recovery responds uniformly and account controls remain provider-owned', async () => {
  const f = fixture(); const r = await f.app.inject({ method: 'POST', url: '/core/identity/v1/session/recovery', payload: { email: 'unknown@example.test' } });
  assert.equal(r.statusCode, 202); const c = await f.app.inject({ url: '/core/identity/v1/controls', headers: { authorization: `Bearer ${f.tokens[0]}` } });
  assert.equal(c.json().consumer_id, f.a.consumer_id); assert.equal(c.json().controls.close, 'https://account.example.test/close'); await f.app.close();
});
test('account authentication has bounded per-IP retry throttling', async () => {
  const f = fixture(); for (let i = 0; i < 10; i++) await f.app.inject({ method: 'POST', url: '/core/identity/v1/session/recovery', payload: { email: 'a@example.test' } });
  assert.equal((await f.app.inject({ method: 'POST', url: '/core/identity/v1/session/recovery', payload: { email: 'a@example.test' } })).statusCode, 429); await f.app.close();
});
