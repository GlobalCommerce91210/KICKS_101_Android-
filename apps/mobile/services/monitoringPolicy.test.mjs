import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMonitoringPolicy } from './monitoringPolicy.ts';
const policy = { permissionId:'fc74d67d-5372-4935-bdea-71e054ad46e2', purpose:'Reviewed synthetic purpose', purposeVersion:'one', policyVersion:'one' };
function fixture(value = { policy, collectionEnabled: false }) {
  return { user:{ subjectId:'one' }, sessionGeneration:1, async request(path) {
    assert.equal(path, '/core/consumer/v1/monitoring-policy');
    return { ok:true, json:async()=>value };
  } };
}
test('authenticated runtime policy replaces missing build-time settings', async () => {
  assert.deepEqual(await loadMonitoringPolicy(fixture()), policy);
});
test('missing, invalid or changed-session policy never enables collection setup', async () => {
  for (const value of [{}, { policy:{...policy,permissionId:'bad'},collectionEnabled:false },
    { policy:{...policy,purpose:''},collectionEnabled:false }, {policy,collectionEnabled:true}]) {
    await assert.rejects(loadMonitoringPolicy(fixture(value)), /could not be verified/);
  }
  const f=fixture(); f.request=async()=>{ f.sessionGeneration++; return {ok:true,json:async()=>({policy,collectionEnabled:false})}; };
  await assert.rejects(loadMonitoringPolicy(f), /session changed/);
  const g=fixture(); g.request=async()=>({ok:false});
  await assert.rejects(loadMonitoringPolicy(g), /unavailable/);
});
