import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollCurrentDevice, revokeAndUnlinkDevice } from './deviceService.mjs';

function fixture() {
  const calls = []; let consent = { action: 'grant', permissionId: 'permission', policyVersion: 'v1', purposeVersion: 'v1', purpose: 'metadata' };
  const manager = { user: { subjectId: 'human' },
    async provisionIosCollector(adapter) { return adapter.provision('staging', 'account-bearer', 'human'); },
    async request(path, init = {}) {
      calls.push({ path, method: init.method ?? 'GET', body: init.body && JSON.parse(init.body) });
      if (init.method === 'POST') consent = { ...consent, action: 'revoke' };
      return { ok: true, async json() { return { consent }; } };
    },
  };
  const native = { async getDeviceId() { return 'device'; }, async stop() { calls.push({ method: 'STOP' }); },
    async getStatus() { return { connected: false, collecting: false }; },
    async provision(origin, bearer, subject) { calls.push({ method: 'PROVISION', origin, subject }); return 'device'; },
  };
  return { manager, native, calls };
}
test('enrollment uses authenticated native proof and never grants consent or starts VPN', async () => {
  const f = fixture(); assert.equal(await enrollCurrentDevice(f.manager, f.native), 'device');
  assert.deepEqual(f.calls, [{ method: 'PROVISION', origin: 'staging', subject: 'human' }]);
});
test('unsupported enrollment fails without account or device mutations', async () => {
  const f = fixture(); await assert.rejects(enrollCurrentDevice(f.manager), /unavailable/); assert.equal(f.calls.length, 0);
});
test('session change during enrollment discards the result', async () => {
  const f = fixture(); f.native.provision = async () => { f.manager.user = { subjectId: 'other' }; return 'device'; };
  await assert.rejects(enrollCurrentDevice(f.manager, f.native), /session changed/);
});
test('stop, consent revocation and verification precede unlink; account subject never becomes collector identity', async () => {
  const f = fixture(); await revokeAndUnlinkDevice(f.manager, 'device', { permissionId: 'permission' }, f.native, 'request');
  assert.deepEqual(f.calls.map(c => c.method), ['STOP', 'GET', 'POST', 'GET', 'DELETE']);
  assert.equal(f.calls[2].body.action, 'revoke'); assert.equal(f.calls[2].body.subjectId, undefined);
});
test('failed revocation leaves the device linked', async () => {
  const f = fixture(); const request = f.manager.request;
  f.manager.request = async (path, init) => init?.method === 'POST' ? { ok: false } : request(path, init);
  await assert.rejects(revokeAndUnlinkDevice(f.manager, 'device', { permissionId: 'permission' }, f.native, 'request'), /could not be revoked/);
  assert.ok(!f.calls.some(c => c.method === 'DELETE'));
});
test('unconfirmed native stop prevents unlink and leaves actionable recovery', async () => {
  const f = fixture(); f.native.getStatus = async () => ({ connected: true });
  await assert.rejects(revokeAndUnlinkDevice(f.manager, 'device', { permissionId: 'permission' }, f.native, 'request'), /VPN Settings/);
  assert.deepEqual(f.calls.map(c => c.method), ['STOP']);
});
test('session switch during consent read prevents revoke or unlink', async () => {
  const f = fixture(); f.manager.request = async () => { f.manager.user = null; return { ok: true }; };
  await assert.rejects(revokeAndUnlinkDevice(f.manager, 'device', { permissionId: 'permission' }, undefined, 'request'), /session changed/);
});
test('missing collection policy prevents partial unlink', async () => {
  const f = fixture(); await assert.rejects(revokeAndUnlinkDevice(f.manager, 'device', {}, f.native, 'request'), /not configured/);
  assert.equal(f.calls.length, 0);
});
