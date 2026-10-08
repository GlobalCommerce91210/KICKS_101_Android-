import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredAccountProvider } from './accountProvider.js';
import { AccountProviderError } from './account.js';
const configure = () => {
  const saved = { ...process.env };
  process.env.DATASTORM_ACCOUNT_ENV = 'staging';
  process.env.DATASTORM_ACCOUNT_PROVIDER_ORIGIN = 'https://canonical-staging.example.test';
  process.env.DATASTORM_ACCOUNT_PROVIDER_CONTRACT = 'consumer-account-v1';
  return () => { for (const key of ['DATASTORM_ACCOUNT_ENV', 'DATASTORM_ACCOUNT_PROVIDER_ORIGIN', 'DATASTORM_ACCOUNT_PROVIDER_CONTRACT']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } };
};
test('HTTP account adapter is disabled unless staging contract is explicitly selected', t => {
  t.after(configure());
  process.env.DATASTORM_ACCOUNT_ENV = 'production'; assert.equal(configuredAccountProvider(), undefined);
  process.env.DATASTORM_ACCOUNT_ENV = 'staging'; delete process.env.DATASTORM_ACCOUNT_PROVIDER_CONTRACT; assert.equal(configuredAccountProvider(), undefined);
});
test('HTTP account adapter refuses insecure origins and URL-embedded secrets', t => {
  t.after(configure());
  for (const origin of ['http://canonical-staging.example.test', 'https://user:password@canonical-staging.example.test', 'https://canonical-staging.example.test/path']) {
    process.env.DATASTORM_ACCOUNT_PROVIDER_ORIGIN = origin; assert.throws(() => configuredAccountProvider());
  }
});
test('HTTP adapter restores canonical identity using bearer token and never follows redirects', async t => {
  t.after(configure());
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const account = { account_id: 'account-fixture', consumer_id: 'consumer-fixture', display_name: 'Fixture', email: null, account_status: 'active', profile_status: 'beta' };
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options }); return new Response(JSON.stringify({ account, expires_at: new Date(Date.now() + 60_000).toISOString() }));
  });
  const result = await configuredAccountProvider()!.restore('canonical-session-fixture');
  assert.equal(result?.account.consumer_id, 'consumer-fixture'); assert.equal(result?.token, 'canonical-session-fixture');
  assert.equal(calls[0]?.url, 'https://canonical-staging.example.test/core/identity/v1/account');
  assert.equal((calls[0]?.options?.headers as Record<string, string>).authorization, 'Bearer canonical-session-fixture');
  assert.equal(calls[0]?.options?.redirect, 'error');
});
test('HTTP adapter treats revoked tokens as unauthenticated and masks provider failures', async t => {
  t.after(configure());
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  assert.equal(await configuredAccountProvider()!.restore('revoked-session-fixture'), null);
  mock.mock.mockImplementation(async () => { throw new Error('private provider failure'); });
  await assert.rejects(configuredAccountProvider()!.restore('session-fixture'), error => error instanceof AccountProviderError && error.status === 503 && !error.message.includes('private'));
});
