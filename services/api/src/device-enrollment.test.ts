import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildServer, memoryStore } from './server.js';
import { createOidcVerifier, oidcConfigFromEnv, OidcVerificationError } from './oidc.js';

const issuer = 'https://identity.example.test';
const audience = 'kicks-api';
const config = { issuer, audience, jwksUrl: `${issuer}/jwks` };

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const publicJwk = await exportJWK(publicKey);
  const keyResolver = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: 'trusted-key', alg: 'RS256', use: 'sig' }]
  });
  const verifier = createOidcVerifier(config, keyResolver);
  const sign = async (subject: string, claims: { issuer?: string; audience?: string | string[]; expired?: boolean } = {}) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
      .setIssuer(claims.issuer ?? issuer)
      .setAudience(claims.audience ?? audience)
      .setSubject(subject)
      .setExpirationTime(claims.expired ? Math.floor(Date.now() / 1000) - 60 : '5m')
      .sign(privateKey);
  const store = memoryStore();
  const app = buildServer({
    store,
    identityVerifier: verifier,
    trustedProxies: ['127.0.0.1']
  });
  const enroll = (identityToken: string, body?: unknown) => app.inject({
    method: 'POST',
    url: '/v1/devices/enroll',
    headers: { authorization: ['Bear', 'er', identityToken].join(' '), 'x-forwarded-proto': 'https' },
    ...(body === undefined ? {} : { payload: body })
  });
  return { app, store, sign, enroll };
}

test('OIDC config is absent only when all settings are absent and rejects partial or insecure settings', () => {
  assert.equal(oidcConfigFromEnv({}), null);
  assert.throws(() => oidcConfigFromEnv({ OIDC_ISSUER: issuer }));
  assert.throws(() => oidcConfigFromEnv({
    OIDC_ISSUER: 'http://identity.example.test',
    OIDC_AUDIENCE: audience,
    OIDC_JWKS_URL: `${issuer}/jwks`
  }));
});

test('device enrollment is unavailable without OIDC config and rejects missing or empty identity', async () => {
  const app = buildServer();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/v1/devices/enroll' })).statusCode, 503);
  } finally {
    await app.close();
  }

  const { app: configuredApp, enroll, sign } = await fixture();
  try {
    assert.equal((await configuredApp.inject({
      method: 'POST', url: '/v1/devices/enroll',
      headers: { 'x-forwarded-proto': 'https' }
    })).statusCode, 401);
    assert.equal((await enroll(await sign(''))).statusCode, 401);
    assert.equal((await enroll(await sign('alice', { expired: true }))).statusCode, 401);
  } finally {
    await configuredApp.close();
  }
});

test('OIDC enrollment rejects issuer, audience, and signature mismatches', async () => {
  const { app, enroll, sign } = await fixture();
  try {
    assert.equal((await enroll(await sign('alice', { issuer: 'https://attacker.example.test' }))).statusCode, 401);
    assert.equal((await enroll(await sign('alice', { audience: 'other-api' }))).statusCode, 401);
    assert.equal((await enroll(await sign('alice', { audience: [audience, 'other-api'] }))).statusCode, 401);

    const { privateKey: attackerKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('alice')
      .setExpirationTime('5m')
      .sign(attackerKey);
    assert.equal((await enroll(forged)).statusCode, 401);
  } finally {
    await app.close();
  }
});

test('enrollment rejects a supplied subject and stores only the generated device-token hash', async () => {
  const { app, store, enroll, sign } = await fixture();
  try {
    const identityToken = await sign('alice');
    assert.equal((await enroll(identityToken, { subjectId: randomUUID() })).statusCode, 400);

    const response = await enroll(identityToken);
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.ok(body.deviceId);
    assert.match(body.subjectId, /^[0-9a-f-]{36}$/);
    assert.equal(body.tokenType, 'Bearer');
    const device = [...store.devices.values()][0]!;
    assert.equal(device.tokenHash, createHash('sha256').update(body.token).digest('hex'));
    assert.equal(Object.hasOwn(device, 'token'), false);
    assert.equal(device.subjectId, body.subjectId);
    assert.equal((await enroll(await sign('alice'))).json().subjectId, body.subjectId);
  } finally {
    await app.close();
  }
});

test('device identity is scoped to its verified account and session requires an active device', async () => {
  const { app, enroll, sign } = await fixture();
  try {
    const alice = (await enroll(await sign('alice'))).json();
    const bob = (await enroll(await sign('bob'))).json();
    assert.notEqual(alice.subjectId, bob.subjectId);

    const permissionId = randomUUID();
    const consent = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers: { authorization: ['Bear', 'er', alice.token].join(' ') },
      payload: {
        permissionId,
        requestId: randomUUID(),
        action: 'grant',
        policyVersion: 'privacy-1',
        purposeVersion: 'network-safety-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(consent.statusCode, 202);

    const session = await app.inject({
      method: 'GET', url: '/v1/devices/session',
      headers: { authorization: ['Bear', 'er', alice.token].join(' ') }
    });
    assert.deepEqual(session.json(), { deviceId: alice.deviceId, subjectId: alice.subjectId });
    const crossAccountRead = await app.inject({
      method: 'GET', url: `/v1/consent-events/${permissionId}`,
      headers: { authorization: ['Bear', 'er', bob.token].join(' ') }
    });
    assert.deepEqual(crossAccountRead.json().events, []);
    await app.inject({ method: 'POST', url: '/v1/devices/revoke', headers: { authorization: ['Bear', 'er', alice.token].join(' ') } });
    assert.equal((await app.inject({
      method: 'GET', url: '/v1/devices/session',
      headers: { authorization: ['Bear', 'er', alice.token].join(' ') }
    })).statusCode, 401);
  } finally {
    await app.close();
  }
});

test('enrollment requires HTTPS and does not trust forwarded protocol from an untrusted peer', async () => {
  const { app, sign } = await fixture();
  const token = await sign('alice');
  try {
    assert.equal((await app.inject({
      method: 'POST', url: '/v1/devices/enroll',
      headers: { authorization: ['Bear', 'er', token].join(' ') }
    })).statusCode, 403);
  } finally {
    await app.close();
  }

  const untrustedProxyApp = buildServer({
    identityVerifier: { verify: async () => ({ issuer, subject: 'alice' }) }
  });
  try {
    assert.equal((await untrustedProxyApp.inject({
      method: 'POST', url: '/v1/devices/enroll',
      headers: { authorization: ['Bear', 'er', 'unused'].join(' '), 'x-forwarded-proto': 'https' }
    })).statusCode, 403);
  } finally {
    await untrustedProxyApp.close();
  }
});

test('OIDC provider and device persistence failures fail closed with 503', async () => {
  const providerUnavailable = buildServer({
    trustedProxies: ['127.0.0.1'],
    identityVerifier: { verify: async () => { throw new OidcVerificationError('unavailable'); } }
  });
  try {
    const response = await providerUnavailable.inject({
      method: 'POST', url: '/v1/devices/enroll',
      headers: { authorization: ['Bear', 'er', 'unused'].join(' '), 'x-forwarded-proto': 'https' }
    });
    assert.equal(response.statusCode, 503);
  } finally {
    await providerUnavailable.close();
  }

  const { app: tokenFactory, sign } = await fixture();
  await tokenFactory.close();
  const jwksUnavailable = buildServer({
    trustedProxies: ['127.0.0.1'],
    identityVerifier: createOidcVerifier(config, async () => { throw new Error('JWKS unavailable'); })
  });
  try {
    const response = await jwksUnavailable.inject({
      method: 'POST', url: '/v1/devices/enroll',
      headers: { authorization: ['Bear', 'er', await sign('alice')].join(' '), 'x-forwarded-proto': 'https' }
    });
    assert.equal(response.statusCode, 503);
  } finally {
    await jwksUnavailable.close();
  }

  let storedHash = '';
  let persistedKeys: string[] = [];
  const persistenceUnavailable = buildServer({
    trustedProxies: ['127.0.0.1'],
    identityVerifier: { verify: async () => ({ issuer, subject: 'alice' }) },
    deviceRepository: {
      create: async device => { storedHash = device.tokenHash; persistedKeys = Object.keys(device); throw new Error('database unavailable'); },
      findActiveByTokenHash: async () => null,
      revokeByTokenHash: async () => false
    }
  });
  try {
    const response = await persistenceUnavailable.inject({
      method: 'POST', url: '/v1/devices/enroll',
      headers: { authorization: ['Bear', 'er', 'unused'].join(' '), 'x-forwarded-proto': 'https' }
    });
    assert.equal(response.statusCode, 503);
    assert.match(storedHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(persistedKeys.sort(), ['id', 'revoked', 'subjectId', 'tokenHash'].sort());
  } finally {
    await persistenceUnavailable.close();
  }
});
