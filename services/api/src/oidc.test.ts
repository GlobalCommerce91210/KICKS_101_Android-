import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign, type JsonWebKey } from 'node:crypto';
import { buildServer, createOidcVerifier, memoryStore } from './server.js';

const ISS = 'https://idp.example.test/', AUD = 'kicks-api';
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwkOf = (k: typeof rsa.publicKey, kid: string) => ({ ...(k.export({ format: 'jwk' }) as JsonWebKey), kid });
const keys = [jwkOf(rsa.publicKey, 'rsa1'), jwkOf(ec.publicKey, 'ec1')];
let clock = 1_800_000_000_000;
const verifyIdentity = createOidcVerifier({ issuer: ISS, audience: AUD, getKeys: async () => keys, now: () => clock });
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims: Record<string, unknown> = {}, o: { alg?: string; kid?: string; key?: typeof rsa.privateKey } = {}) {
  const alg = o.alg ?? 'RS256', head = enc({ alg, kid: o.kid ?? (alg === 'RS256' ? 'rsa1' : 'ec1'), typ: 'JWT' });
  const body = enc({ iss: ISS, aud: AUD, sub: 'acct-a', exp: clock / 1000 + 600, ...claims });
  const signed = Buffer.from(`${head}.${body}`);
  const sig = alg === 'ES256' ? sign('sha256', signed, { key: o.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' }) : sign('sha256', signed, o.key ?? rsa.privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}
const setup = () => buildServer({ store: memoryStore(), verifyIdentity });
const auth = (t: string, dev?: string): Record<string, string> => ({ authorization: ['Bearer', t].join(' '), ...(dev ? { 'x-kicks-device': dev } : {}) });

test('verifier accepts RS256 and ES256 and rejects bad tokens', async () => {
  assert.equal((await verifyIdentity(jwt()))?.sub, 'acct-a');
  assert.equal((await verifyIdentity(jwt({}, { alg: 'ES256' })))?.sub, 'acct-a');
  const bad = [jwt({ iss: 'https://evil/' }), jwt({ aud: 'other' }), jwt({ exp: clock / 1000 - 100 }), jwt({ sub: '' }),
    jwt({ nbf: clock / 1000 + 3600 }), jwt({}, { kid: 'unknown' }), jwt({}, { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }),
    jwt().slice(0, -4) + 'AAAA', 'a.b', `${enc({ alg: 'none', kid: 'rsa1' })}.${enc({ iss: ISS, aud: AUD, sub: 'x', exp: clock / 1000 + 60 })}.`];
  for (const t of bad) assert.equal(await verifyIdentity(t), null);
});

test('enrollment binds device to one account and rejects cross-account relink', async () => {
  const app = setup(), dev = randomUUID();
  assert.equal((await app.inject({ method: 'POST', url: '/v1/devices/enroll', payload: { deviceId: dev } })).statusCode, 401);
  const a = await app.inject({ method: 'POST', url: '/v1/devices/enroll', headers: auth(jwt()), payload: { deviceId: dev } });
  assert.equal(a.statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/devices/enroll', headers: auth(jwt()), payload: { deviceId: dev } })).statusCode, 200);
  const b = await app.inject({ method: 'POST', url: '/v1/devices/enroll', headers: auth(jwt({ sub: 'acct-b' })), payload: { deviceId: dev } });
  assert.equal(b.statusCode, 403); assert.equal(b.json().error, 'device_owned_by_another_account');
  const e = await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: auth(jwt({ sub: 'acct-b' }), dev) });
  assert.equal(e.statusCode, 403); assert.match(e.body, /device_owned_by_another_account/);
});

test('eligibility reflects enrollment, consent and data sharing separately; expiry and revocation fail closed', async () => {
  const app = setup(), dev = randomUUID(), h = () => auth(jwt(), dev);
  let e = (await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).json();
  assert.equal(e.deviceOwnerAccountId, null);
  await app.inject({ method: 'POST', url: '/v1/devices/enroll', headers: auth(jwt()), payload: { deviceId: dev } });
  e = (await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).json();
  assert.deepEqual([e.deviceOwnerAccountId, e.consentState, e.dataSharing], ['acct-a', 'none', false]);
  const permissionId = randomUUID();
  await app.inject({ method: 'POST', url: '/v1/consent-events', headers: h(), payload: { permissionId, action: 'grant', policyVersion: '1', purposeVersion: '1', purpose: 'fraud-detection' } });
  e = (await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).json();
  assert.deepEqual([e.consentState, e.consentId, e.dataSharing], ['granted', permissionId, false]);
  await app.inject({ method: 'PUT', url: '/v1/data-sharing', headers: h(), payload: { enabled: true } });
  e = (await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).json();
  assert.equal(e.dataSharing, true);
  await app.inject({ method: 'POST', url: '/v1/consent-events', headers: h(), payload: { permissionId, action: 'revoke', policyVersion: '1', purposeVersion: '1', purpose: 'fraud-detection' } });
  assert.equal((await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).json().consentState, 'none');
  // remote revocation of the device
  assert.equal((await app.inject({ method: 'POST', url: `/v1/devices/${dev}/revoke`, headers: h() })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).statusCode, 401);
  // expiry
  clock += 3_600_000;
  assert.equal((await app.inject({ method: 'GET', url: '/v1/collector/eligibility', headers: h() })).statusCode, 401);
  clock -= 3_600_000;
});

test('uploads with an IdP token require an enrolled device owned by that account', async () => {
  const app = setup(), dev = randomUUID(), permissionId = randomUUID();
  await app.inject({ method: 'POST', url: '/v1/devices/enroll', headers: auth(jwt()), payload: { deviceId: dev } });
  await app.inject({ method: 'POST', url: '/v1/consent-events', headers: auth(jwt(), dev), payload: { permissionId, action: 'grant', policyVersion: '1', purposeVersion: '1', purpose: 'fraud-detection' } });
  const body = { batchId: randomUUID(), schemaVersion: '2026-08-01', observations: [{ eventId: randomUUID(), occurredAt: new Date().toISOString(), sourceApp: null, attribution: 'unknown', destinationHost: 'example.com', protocol: 'dns', bytesBucket: '0-1KB', classification: 'unknown', consentId: permissionId, consentPurpose: 'fraud-detection' }] };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: auth(jwt({ sub: 'acct-b' }), dev), payload: body })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: auth(jwt()), payload: body })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: auth(jwt(), dev), payload: body })).statusCode, 202);
});

test('staging device route is off by default and enrollment is rate limited', async () => {
  const off = buildServer({ adminSecret: 's' });
  assert.equal((await off.inject({ method: 'POST', url: '/v1/staging/devices', headers: { 'x-admin-secret': 's' }, payload: { subjectId: randomUUID() } })).statusCode, 404);
  const app = setup(); let last = 0;
  for (let i = 0; i < 40; i++) last = (await app.inject({ method: 'POST', url: '/v1/devices/enroll', payload: { deviceId: randomUUID() } })).statusCode;
  assert.equal(last, 429);
});
