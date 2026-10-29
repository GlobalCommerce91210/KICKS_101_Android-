import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { CollectorAuthorizationError, CollectorAuthorizationService } from './collector-authorization.js';
import type { CollectorAuthorizationRequest, CollectorEvidence } from './collector-authorization.js';
import { simulatedAuth, verifiedEvidence } from './test-support.js';

const request: CollectorAuthorizationRequest = {
  authenticatedSubject: 'subject-1', deviceId: 'device-1', consentScope: 'scope-1',
  purpose: 'Detect unexpected data destinations', requestedOperation: 'metadata.ingest'
};
const service = (overrides: Partial<CollectorEvidence>) => simulatedAuth(overrides);

test('every authorization condition denies with the expected state', async () => {
  const cases: Array<[Partial<CollectorEvidence>, string]> = [
    [{ subjectValid: false }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    [{ deviceOwnerSubject: 'someone-else' }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    [{ deviceEnrollment: 'PENDING' }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    [{ deviceEnrollment: 'UNKNOWN' }, 'BLOCKED_DEVICE_NOT_ENROLLED'],
    [{ deviceEnrollment: 'REVOKED' }, 'BLOCKED_REVOKED'],
    [{ consentDecision: 'REVOKE' }, 'BLOCKED_NO_CONSENT'],
    [{ consentDecision: 'DENY' }, 'BLOCKED_NO_CONSENT'],
    [{ consentDecision: 'UNKNOWN' }, 'BLOCKED_NO_CONSENT'],
    [{ consentScope: 'other-scope' }, 'BLOCKED_NO_CONSENT'],
    [{ consentPurpose: 'other purpose' }, 'BLOCKED_NO_CONSENT'],
    [{ policyVersion: 'old' }, 'BLOCKED_POLICY'],
    [{ disclosureVersion: 'old' }, 'BLOCKED_POLICY'],
    [{ receiptDecisionVersion: 'v0' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ receiptStatus: 'MISSING' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ receiptStatus: 'UNKNOWN' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ proofStatus: 'PENDING' }, 'BLOCKED_STAMP_PENDING'],
    [{ proofStatus: 'FAILED' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ proofStatus: 'MISSING' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ proofStatus: 'UNKNOWN' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ finalityReached: false }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ proofChain: 'wrong-chain' }, 'BLOCKED_VERIFICATION_FAILED'],
    [{ osPermissionEvidence: 'MISSING' }, 'BLOCKED_OS_PERMISSION'],
    [{ osPermissionEvidence: 'INVALID' }, 'BLOCKED_OS_PERMISSION'],
    [{ safetyPolicy: 'FAIL' }, 'BLOCKED_POLICY'],
    [{ safetyPolicy: 'UNKNOWN' }, 'BLOCKED_POLICY'],
    [{ revoked: true }, 'BLOCKED_REVOKED'],
    [{ expired: true }, 'BLOCKED_REVOKED'],
    [{ superseded: true }, 'BLOCKED_REVOKED'],
    [{ expiresAt: 0 }, 'BLOCKED_REVOKED'],
    [{ revocationEpoch: -1 }, 'BLOCKED_SERVICE_UNAVAILABLE']
  ];
  for (const [overrides, state] of cases) {
    const result = await service(overrides).authorizeCollector(request);
    assert.equal(result.eligible, false, JSON.stringify(overrides));
    assert.equal(result.state, state, JSON.stringify(overrides));
    assert.equal(result.authorizationId, undefined);
  }
  const ok = await service({}).authorizeCollector(request);
  assert.equal(ok.state, 'ELIGIBLE');
  assert.ok(ok.authorizationId);
});

test('missing provider, null evidence, thrown errors and incomplete context fail closed', async () => {
  assert.equal((await new CollectorAuthorizationService(undefined).authorizeCollector(request)).state, 'BLOCKED_SERVICE_UNAVAILABLE');
  assert.equal((await new CollectorAuthorizationService({ loadEvidence: async () => null }).authorizeCollector(request)).eligible, false);
  const throwing = new CollectorAuthorizationService({ loadEvidence: async () => { throw new Error('timeout'); } });
  assert.equal((await throwing.authorizeCollector(request)).reason, 'authoritative_evidence_unavailable');
  assert.equal((await simulatedAuth().authorizeCollector({ ...request, deviceId: '' })).state, 'BLOCKED_POLICY');
  await assert.rejects(new CollectorAuthorizationService(undefined).runAuthorized(request, async () => 'x'), CollectorAuthorizationError);
});

test('issued authorization is scope bound, revalidated and invalidated by epoch change or revocation', async () => {
  let epoch = 0;
  let revoked = false;
  const svc = new CollectorAuthorizationService({ loadEvidence: async r => verifiedEvidence(r, { revocationEpoch: epoch, revoked }) });
  const issued = await svc.authorizeCollector(request);
  assert.equal((await svc.validateAuthorization(issued.authorizationId!, request)).eligible, true);
  assert.equal((await svc.validateAuthorization(issued.authorizationId!, { ...request, consentScope: 'x' })).eligible, false);
  assert.equal((await svc.validateAuthorization('forged', request)).eligible, false);
  epoch = 1;
  assert.equal((await svc.validateAuthorization(issued.authorizationId!, request)).reason, 'consent_version_or_revocation_epoch_changed');
  epoch = 1;
  const second = await svc.authorizeCollector(request);
  revoked = true;
  assert.equal((await svc.validateAuthorization(second.authorizationId!, request)).state, 'BLOCKED_REVOKED');
});

test('TTL expiry does not replace revocation checks and expires capabilities', async () => {
  let now = 1_000;
  const svc = simulatedAuth({ expiresAt: 10_000_000 }, () => now);
  const issued = await svc.authorizeCollector(request);
  now += 61_000;
  assert.equal((await svc.validateAuthorization(issued.authorizationId!, request)).reason, 'authorization_capability_expired');
});

test('runAuthorized performs work inside the provider transaction and denies on concurrent revocation', async () => {
  let revoked = false;
  const events: string[] = [];
  const svc = new CollectorAuthorizationService({
    loadEvidence: async (r, tx) => { events.push(`load:${String(tx)}`); return verifiedEvidence(r, { revoked }); },
    withIngestionTransaction: async (_r, work) => { events.push('begin'); const out = await work('tx1'); events.push('commit'); return out; }
  });
  assert.equal(await svc.runAuthorized(request, async tx => `done:${String(tx)}`), 'done:tx1');
  assert.deepEqual(events, ['begin', 'load:tx1', 'commit']);
  revoked = true;
  events.length = 0;
  await assert.rejects(svc.runAuthorized(request, async () => { events.push('write'); }), CollectorAuthorizationError);
  assert.ok(!events.includes('write'));
});

const setup = async (collectorAuthorization?: CollectorAuthorizationService, extra: Record<string, unknown> = {}) => {
  const store = memoryStore();
  const app = buildServer({ store, adminSecret: 's', collectorAuthorization, ...extra });
  const subjectId = randomUUID();
  const enrolled = (await app.inject({ method: 'POST', url: '/v1/staging/devices', headers: { 'x-admin-secret': 's' }, payload: { subjectId } })).json();
  const headers = { authorization: 'Bearer ' + (enrolled.token as string) };
  return { app, store, headers, deviceId: enrolled.deviceId as string };
};
const purpose = 'Detect unexpected data destinations';
const grant = (app: ReturnType<typeof buildServer>, headers: Record<string, string>, permissionId: string, action: 'grant' | 'revoke' = 'grant') =>
  app.inject({ method: 'POST', url: '/v1/consent-events', headers, payload: { permissionId, requestId: randomUUID(), action, policyVersion: 'p1', purposeVersion: 'v1', purpose } });
const observation = (consentId: string) => ({
  eventId: randomUUID(), occurredAt: new Date().toISOString(), sourceApp: 'com.example', attribution: 'verified', destinationHost: 'api.example.com',
  protocol: 'tls', bytesBucket: '1-10KB', classification: 'expected', consentId, consentPurpose: purpose
});
const batchOf = (...ids: string[]) => ({ batchId: randomUUID(), schemaVersion: '2026-08-01', observations: ids.map(observation) });

test('metadata ingestion: grant without verified proof returns 403, is audited and writes nothing', async () => {
  for (const overrides of [{ proofStatus: 'PENDING' as const }, { proofStatus: 'FAILED' as const }, { proofStatus: 'MISSING' as const }]) {
    const { app, store, headers, deviceId } = await setup(simulatedAuth(overrides));
    const permissionId = randomUUID();
    await grant(app, headers, permissionId);
    const res = await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: batchOf(permissionId) });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, 'collector_not_authorized');
    assert.equal(store.observations.length, 0);
    assert.equal(store.collectorAudit.length, 1);
    assert.equal(store.collectorAudit[0]!.deviceId, deviceId);
    assert.equal(JSON.stringify(store.collectorAudit[0]).includes(headers.authorization), false);
    await app.close();
  }
});

test('metadata ingestion fails closed with no or unavailable authorization dependency', async () => {
  const none = await setup(undefined);
  const permissionId = randomUUID();
  await grant(none.app, none.headers, permissionId);
  const unavailable = await none.app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: none.headers, payload: batchOf(permissionId) });
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.json(), { error: 'collector_authorization_unavailable', state: 'BLOCKED_SERVICE_UNAVAILABLE', eligible: false });
  assert.equal(none.store.observations.length, 0);
  assert.equal(none.store.collectorAudit[0]!.state, 'BLOCKED_SERVICE_UNAVAILABLE');
  assert.equal(none.store.collectorAudit[0]!.reason, 'authoritative_evidence_provider_missing');
  const down = await setup(new CollectorAuthorizationService({ loadEvidence: async () => { throw new Error('down'); } }));
  await grant(down.app, down.headers, permissionId);
  const res = await down.app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: down.headers, payload: batchOf(permissionId) });
  assert.equal(res.statusCode, 503);
  assert.equal(down.store.observations.length, 0);
});

test('metadata ingestion rejects whole batch when any observation is unauthorized and preserves replay detection', async () => {
  const good = randomUUID(); const bad = randomUUID();
  const svc = new CollectorAuthorizationService({ loadEvidence: async r => verifiedEvidence(r, r.consentScope === bad ? { proofStatus: 'PENDING' } : {}) });
  const { app, store, headers } = await setup(svc);
  await grant(app, headers, good); await grant(app, headers, bad);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: batchOf(good, bad) })).statusCode, 403);
  assert.equal(store.observations.length, 0);
  assert.equal(store.batches.size, 0);
  const ok = batchOf(good);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: ok })).statusCode, 202);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: ok })).statusCode, 409);
  assert.equal(store.observations.length, 1);
});

test('client-provided verified flags are rejected by the strict schema', async () => {
  const { app, headers } = await setup(simulatedAuth());
  const permissionId = randomUUID();
  await grant(app, headers, permissionId);
  const payload = batchOf(permissionId) as any;
  payload.observations[0].verified = true;
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload })).statusCode, 400);
});

test('concurrent revocation during ingestion cannot commit data', async () => {
  let revoked = false;
  const svc = new CollectorAuthorizationService({
    loadEvidence: async r => verifiedEvidence(r, { revoked }),
    withIngestionTransaction: async (_r, work) => { const out = work('tx'); revoked = true; return out; }
  });
  const permissionId = randomUUID();
  const { app, store, headers } = await setup(svc);
  await grant(app, headers, permissionId);
  // Revoke lands after the pre-commit evidence read of the first provider call.
  const flip = new CollectorAuthorizationService({
    loadEvidence: async r => { const e = verifiedEvidence(r, { revoked }); return e; },
    withIngestionTransaction: async (_r, work) => { revoked = true; return work('tx'); }
  });
  const second = await setup(flip);
  await grant(second.app, second.headers, permissionId);
  assert.equal((await second.app.inject({ method: 'POST', url: '/v1/metadata-batches', headers: second.headers, payload: batchOf(permissionId) })).statusCode, 403);
  assert.equal(second.store.observations.length, 0);
  assert.equal(store.observations.length, 0);
});

test('consent revocation invalidates authorization immediately and notifies collectors', async () => {
  const stopped: string[] = [];
  const { app, store, headers } = await setup(simulatedAuth(), { onCollectorStop: (s: string) => stopped.push(s) });
  const permissionId = randomUUID();
  await grant(app, headers, permissionId);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: batchOf(permissionId) })).statusCode, 202);
  await grant(app, headers, permissionId, 'revoke');
  assert.ok(stopped.length >= 2);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/metadata-batches', headers, payload: batchOf(permissionId) })).statusCode, 403);
  const elig = await app.inject({ method: 'POST', url: '/v1/collector/eligibility', headers, payload: { permissionId, purpose, activationRequested: true } });
  assert.equal(elig.statusCode, 403);
  assert.equal(store.observations.length, 1);
});

test('collector eligibility remains informational without verified proof', async () => {
  const { app, headers } = await setup(simulatedAuth({ proofStatus: 'PENDING' }));
  const permissionId = randomUUID();
  await grant(app, headers, permissionId);
  const res = await app.inject({ method: 'POST', url: '/v1/collector/eligibility', headers, payload: { permissionId, purpose, activationRequested: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().eligible, true);
  assert.equal(res.json().state, 'ELIGIBLE');
  assert.equal(res.json().authorizationId, undefined);
  assert.equal(res.json().expiresAt, undefined);
  const ok = await setup(simulatedAuth());
  await grant(ok.app, ok.headers, permissionId);
  const okRes = await ok.app.inject({ method: 'POST', url: '/v1/collector/eligibility', headers: ok.headers, payload: { permissionId, purpose, activationRequested: true } });
  assert.equal(okRes.json().state, 'ELIGIBLE');
  assert.equal(okRes.json().authorizationId, undefined);
});

const telemetry = (deviceId: string) => ({
  event_id: randomUUID(), timestamp: new Date().toISOString(), app_id: 'com.retail.shop', device_id: deviceId,
  network: { domain: 'analytics.adservice.net', endpoint: '/t', method: 'POST', status_code: 200 }
});

test('intelligence events: synthetic fixtures are disabled by default and in production; real events need authorization', async () => {
  const anon = buildServer();
  assert.equal((await anon.inject({ method: 'POST', url: '/v1/intelligence/events', payload: telemetry('d') })).statusCode, 401);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const prod = buildServer({ allowSyntheticDevelopmentEvents: true });
    assert.equal((await prod.inject({ method: 'POST', url: '/v1/intelligence/events', payload: telemetry('d') })).statusCode, 401);
  } finally { process.env.NODE_ENV = previous; }
  const dev = buildServer({ allowSyntheticDevelopmentEvents: true });
  const synthetic = await dev.inject({ method: 'POST', url: '/v1/intelligence/events', payload: telemetry('d') });
  assert.equal(synthetic.statusCode, 200);
  assert.equal(synthetic.headers['x-kicks-event-origin'], 'synthetic');
  // a bogus credential never falls back to synthetic handling
  assert.equal((await dev.inject({ method: 'POST', url: '/v1/intelligence/events', headers: { authorization: '******' }, payload: telemetry('d') })).statusCode, 401);

  const permissionId = randomUUID();
  const denied = await setup(undefined, { allowSyntheticDevelopmentEvents: true });
  const consentHeaders = { ...denied.headers, 'x-kicks-consent-id': permissionId, 'x-kicks-consent-purpose': purpose };
  const unavailableEvent = await denied.app.inject({ method: 'POST', url: '/v1/intelligence/events', headers: consentHeaders, payload: telemetry(denied.deviceId) });
  assert.equal(unavailableEvent.statusCode, 503);
  assert.deepEqual(unavailableEvent.json(), { error: 'collector_authorization_unavailable', state: 'BLOCKED_SERVICE_UNAVAILABLE', eligible: false });
  assert.equal((await denied.app.inject({ method: 'POST', url: '/v1/intelligence/events', headers: denied.headers, payload: telemetry(denied.deviceId) })).statusCode, 403);

  const allowed = await setup(simulatedAuth());
  const h = { ...allowed.headers, 'x-kicks-consent-id': permissionId, 'x-kicks-consent-purpose': purpose };
  assert.equal((await allowed.app.inject({ method: 'POST', url: '/v1/intelligence/events', headers: h, payload: telemetry(allowed.deviceId) })).statusCode, 200);
  assert.equal((await allowed.app.inject({ method: 'POST', url: '/v1/intelligence/events', headers: h, payload: telemetry('another-device') })).statusCode, 403);
});
