import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsumerProfile } from './profileService.ts';

function response(body, status = 200) {
  return Response.json(body, { status });
}

test('hydrates profile from the verified DataStorm subject and keeps device identity separate', async () => {
  const calls = [];
  const manager = {
    user: { subjectId: 'ds-sub', email: 'owner@example.test' },
    async request(path) {
      calls.push(path);
      if (path === '/core/identity/v1/account') return response({ subject_id: 'ds-sub', email: 'owner@example.test', account_status: 'active' });
      if (path === '/core/identity/v1/products/kicks') return response({ entitlement: { subject_id: 'ds-sub', status: 'active' }, profile: { subject_id: 'ds-sub', status: 'active' } });
      if (path === '/v1/me/consumer-state') return response({ status: 'active' });
      if (path === '/core/consumer/v1/snapshot') return response({ monitoring: { status: 'active', apps_observed: 4 } });
      if (path === '/core/consumer/v1/devices') return response({ devices: [{ device_id: 'device-1', collector_status: 'healthy' }] });
      if (path.endsWith('/effective')) return response({ apps: [{ app_id: 'app-1' }] });
      if (path.includes('/consent-log?')) return response({ items: [{ log_id: 'log-1' }] });
      if (path === '/core/consumer/v1/wallet') return response({ total_earned: 4.25, total_pending: 1, total_settled: 3.25 });
      return response({ error: 'not_found' }, 404);
    }
  };

  const view = await loadConsumerProfile(manager);
  assert.equal(view.account.subjectId, 'ds-sub');
  assert.equal(view.devices[0].device_id, 'device-1');
  assert.equal(view.monitoring.status, 'active');
  assert.equal(view.wallet.total_earned, 4.25);
  assert.ok(calls.includes('/core/consumer/v1/permissions/effective'));
  assert.ok(calls.every(path => !path.includes('device-1/effective')));
});

test('fails closed when the account and KICK’S product identity do not match', async () => {
  const manager = {
    user: { subjectId: 'ds-sub', email: 'owner@example.test' },
    async request(path) {
      if (path.endsWith('/account')) return response({ subject_id: 'other-sub', email: 'owner@example.test', account_status: 'active' });
      if (path.endsWith('/products/kicks')) return response({ entitlement: { subject_id: 'ds-sub', status: 'active' }, profile: { subject_id: 'ds-sub', status: 'active' } });
      return response({});
    }
  };
  await assert.rejects(() => loadConsumerProfile(manager), /identity mismatch/i);
});

test('marks optional staging sources unavailable without fabricating live data', async () => {
  const manager = {
    user: { subjectId: 'ds-sub', email: 'owner@example.test' },
    async request(path) {
      if (path.endsWith('/account')) return response({ subject_id: 'ds-sub', email: 'owner@example.test', account_status: 'active' });
      if (path.endsWith('/products/kicks')) return response({ entitlement: { subject_id: 'ds-sub', status: 'active' }, profile: { subject_id: 'ds-sub', status: 'active' } });
      return response({ error: 'not_found' }, 404);
    }
  };
  const view = await loadConsumerProfile(manager);
  assert.equal(view.wallet, null);
  assert.equal(view.monitoring, null);
  assert.ok(view.unavailable.includes('wallet'));
  assert.ok(view.unavailable.includes('consumer snapshot'));
});

test('does not publish hydrated data after the session changes during resource reads', async () => {
  const user = { subjectId: 'ds-sub', email: 'owner@example.test' };
  const manager = {
    user,
    async request(path) {
      if (path.endsWith('/account')) return response({ subject_id: 'ds-sub', account_status: 'active' });
      if (path.endsWith('/products/kicks')) return response({ entitlement: { subject_id: 'ds-sub', status: 'active' }, profile: { subject_id: 'ds-sub', status: 'active' } });
      manager.user = { subjectId: 'new-sub', email: 'other@example.test' };
      return response({});
    }
  };
  await assert.rejects(loadConsumerProfile(manager), /session changed/i);
});

for (const denied of [
  { accountStatus: 'suspended' },
  { accountStatus: 'closed' },
  { accountStatus: undefined },
  { entitlementStatus: 'revoked' },
  { profileStatus: 'suspended' },
  { entitlementSubject: 'other-sub' },
  { missingEntitlement: true }
]) {
  test('profile rechecks access before resource reads: ' + JSON.stringify(denied), async () => {
    let resourceReads = 0;
    const manager = {
      user: { subjectId: 'ds-sub', email: 'owner@example.test' },
      async request(path) {
        if (path.endsWith('/account')) return response({ subject_id: 'ds-sub', account_status: 'accountStatus' in denied ? denied.accountStatus : 'active' });
        if (path.endsWith('/products/kicks')) return response({
          entitlement: denied.missingEntitlement ? undefined : { subject_id: denied.entitlementSubject ?? 'ds-sub', status: denied.entitlementStatus ?? 'active' },
          profile: { subject_id: 'ds-sub', status: denied.profileStatus ?? 'active' }
        });
        resourceReads++;
        return response({});
      }
    };
    await assert.rejects(loadConsumerProfile(manager), /access is unavailable|identity mismatch/i);
    assert.equal(resourceReads, 0);
  });
}

test('malformed account responses produce a recoverable profile error', async () => {
  const manager = {user:{subjectId:'ds-sub',email:'owner@example.test'}, request:async () => response(null)};
  await assert.rejects(() => loadConsumerProfile(manager), /invalid response/);
});

test('malformed device entries cannot crash the profile renderer', async () => {
  const manager = {
    user: {subjectId:'ds-sub',email:'owner@example.test'},
    async request(path) {
      if (path.endsWith('/account')) return response({subject_id:'ds-sub',account_status:'active'});
      if (path.endsWith('/products/kicks')) return response({profile:{subject_id:'ds-sub',status:'active'},entitlement:{subject_id:'ds-sub',status:'active'}});
      if (path.endsWith('/devices')) return response({devices:[null,42,{device_id:'synthetic-device',display_name:{unexpected:true}}]});
      return response({});
    },
  };
  const profile = await loadConsumerProfile(manager);
  assert.equal(profile.devices.length,1);
  assert.equal(profile.devices[0].device_id,'synthetic-device');
  assert.ok(profile.unavailable.includes('connected devices'));
});
