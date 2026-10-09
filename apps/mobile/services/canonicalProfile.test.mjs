import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCanonicalProfile } from './canonicalProfile.ts';
const subject = 'ds-sub-a';
function requester(overrides = {}) {
  const responses = {
    '/core/consumer/v1/profile': { account: { subject_id: subject }, entitlement: { subject_id: subject }, profile: { subject_id: subject } },
    '/core/consumer/v1/snapshot': { consumer: { subject_id: subject }, snapshot_status: 'partial', monitoring: { status: 'inactive', source_status: 'not_configured' } },
    '/core/consumer/v1/devices': { devices: [] },
    ...overrides,
  };
  return { request: async path => new Response(JSON.stringify(responses[path]), { status: 200 }) };
}
test('Profile uses the actual canonical routes and retains partial source states', async () => {
  const result = await loadCanonicalProfile(requester(), subject);
  assert.equal(result.profile.data.account.subject_id, subject);
  assert.equal(result.snapshot.data.monitoring.source_status, 'not_configured');
  assert.deepEqual(result.devices.data.devices, []);
});
test('another consumer cannot appear in Profile, snapshot, or device responses', async () => {
  const result = await loadCanonicalProfile(requester({
    '/core/consumer/v1/profile': { account: { subject_id: 'other' }, entitlement: { subject_id: subject }, profile: { subject_id: subject } },
    '/core/consumer/v1/snapshot': { consumer: { subject_id: 'other' } },
    '/core/consumer/v1/devices': { devices: [{ device_id: 'device-b', subject_id: 'other' }] },
  }), subject);
  for (const section of Object.values(result)) { assert.equal(section.data, undefined); assert.ok(section.error); }
});
test('a failing or malformed resource stays unavailable without hiding valid independent sections', async () => {
  const base = requester();
  const result = await loadCanonicalProfile({ request: path => path.endsWith('/devices') ? Promise.resolve(new Response('<html>fallback</html>')) : base.request(path) }, subject);
  assert.ok(result.devices.error); assert.equal(result.devices.data, undefined);
  assert.ok(result.profile.data); assert.ok(result.snapshot.data);
});
