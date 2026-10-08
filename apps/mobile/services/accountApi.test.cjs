const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { requireIosApiOrigin } = require('./iosApiOrigin.js');

function client(platform, respond, deleteFails = false) {
  const stored = new Map(), requests = [], exports = {};
  const source = ts.transpileModule(fs.readFileSync(require.resolve('./accountApi.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, URL, AbortController, setTimeout, clearTimeout,
    process: { env: { EXPO_PUBLIC_IOS_API_URL: 'https://staging.example.test', EXPO_PUBLIC_API_URL: 'https://staging.example.test' } },
    require(name) {
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo-secure-store') return { getItemAsync: async key => stored.get(key) || null, setItemAsync: async (key, value) => { stored.set(key, value); }, deleteItemAsync: async key => { if (deleteFails) throw new Error('fixture secure storage failure'); stored.delete(key); } };
      if (name === './iosApiOrigin') return { requireIosApiOrigin };
      throw new Error(`Unexpected import: ${name}`);
    },
    fetch: async (url, options) => { requests.push({ url, options }); return respond(url, options); }
  });
  return { ...exports, stored, requests };
}
const account = { account_id: 'account-fixture', consumer_id: 'consumer-fixture', display_name: 'Fixture', email: null, account_status: 'active', profile_status: 'beta' };
const session = { account, token: 'canonical-human-session-fixture', expires_at: new Date(Date.now() + 60_000).toISOString() };
const ok = value => ({ ok: true, status: 200, json: async () => value });
test('native session is saved only in secure storage and restored against canonical account API', async () => {
  const c = client('ios', url => ok(url.endsWith('/login') ? session : { account, expires_at: session.expires_at }));
  await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password');
  assert.deepEqual([...c.stored.values()], [session.token]);
  const restored = await c.accountApi.restore(); assert.equal(restored.account.consumer_id, account.consumer_id);
  assert.equal(c.requests[1].url, 'https://staging.example.test/core/identity/v1/account');
  assert.equal(c.requests[1].options.headers.authorization, `Bearer ${session.token}`);
});
test('Android account requests use configured remote HTTPS origin', async () => {
  const c = client('android', () => ok(session)); await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password');
  assert.match(c.requests[0].url, /^https:\/\/staging.example.test\//);
});
test('web uses cookies and never writes the session token into client storage', async () => {
  const c = client('web', () => ok({ account, expires_at: session.expires_at }));
  await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password'); await c.accountApi.restore();
  assert.equal(c.stored.size, 0); assert.equal(c.requests[1].options.credentials, 'same-origin');
  assert.equal(c.requests[1].options.headers.authorization, undefined);
});
test('expired profile request deletes the native token and triggers login state', async () => {
  let expired = false, authenticated = false;
  const c = client('ios', () => authenticated ? { ok: false, status: 401 } : ok(session));
  c.onSessionExpired(() => { expired = true; }); await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password'); authenticated = true;
  await assert.rejects(c.accountApi.resource('/core/consumer/v1/snapshot'), e => e.status === 401);
  assert.equal(expired, true); assert.equal(c.stored.size, 0);
});
test('provider outage does not erase a recoverable native session or claim session expiry', async () => {
  let expired = false, authenticated = false;
  const c = client('ios', () => authenticated ? { ok: false, status: 503 } : ok(session));
  c.onSessionExpired(() => { expired = true; }); await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password'); authenticated = true;
  await assert.rejects(c.accountApi.restore(), e => e.status === 503);
  assert.equal(expired, false); assert.equal(c.stored.size, 1);
});
test('logout clears native session even when canonical revocation cannot be confirmed', async () => {
  const c = client('ios', url => url.endsWith('/logout') ? { ok: false, status: 503 } : ok(session));
  await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password');
  await assert.rejects(c.accountApi.logout(), e => e.status === 503); assert.equal(c.stored.size, 0);
  await assert.rejects(c.accountApi.restore(), e => e.status === 401);
});
test('secure-storage removal failure cannot prevent expired-session redirect notification', async () => {
  let expired = false, authenticated = false;
  const c = client('ios', () => authenticated ? { ok: false, status: 401 } : ok(session), true);
  c.onSessionExpired(() => { expired = true; }); await c.accountApi.authenticate('login', 'fixture@example.test', 'fixture-password'); authenticated = true;
  await assert.rejects(c.accountApi.resource('/v1/me/wallet'), e => e.status === 401); assert.equal(expired, true);
});
