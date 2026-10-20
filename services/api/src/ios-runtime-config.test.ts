import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolveIosGatewayRuntime } from './ios-runtime-config.js';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import { IosGatewayEnrollment, MemoryGatewayLeaseStore } from './ios-gateway-enrollment.js';

const env = {
  DATABASE_URL:'postgres://isolated-test.invalid/test', KICKS_IOS_GATEWAY_ENABLED:'true',
  KICKS_IOS_GATEWAY_HOST:'gateway.example.test',KICKS_IOS_GATEWAY_PORT:'51820',
  KICKS_IOS_GATEWAY_PUBLIC_KEY:Buffer.alloc(32,7).toString('base64'),
  KICKS_IOS_GATEWAY_AUTHORITY_SECRET:'synthetic-separate-authority-secret-2026',
  KICKS_MONITORING_PERMISSION_ID:randomUUID(),KICKS_MONITORING_PURPOSE:'Reviewed synthetic purpose',
  KICKS_MONITORING_POLICY_VERSION:'one',KICKS_MONITORING_PURPOSE_VERSION:'one',
};
test('runtime gateway requires durable staging and complete validated explicit configuration',()=>{
  assert.equal(resolveIosGatewayRuntime({},'staging'),null);
  assert.throws(()=>resolveIosGatewayRuntime(env,'production'),/durable staging/);
  for(const key of Object.keys(env).filter(key=>key!=='KICKS_IOS_GATEWAY_ENABLED')) {
    assert.throws(()=>resolveIosGatewayRuntime({...env,[key]:''},'staging'));
  }
  for(const change of [{KICKS_IOS_GATEWAY_PORT:'0'},{KICKS_IOS_GATEWAY_PUBLIC_KEY:Buffer.alloc(32).toString('base64')},
    {KICKS_MONITORING_PURPOSE:'x'.repeat(121)},{KICKS_MONITORING_PERMISSION_ID:'invalid'},
    {KICKS_STAGING_ADMIN_SECRET:env.KICKS_IOS_GATEWAY_AUTHORITY_SECRET}]) {
    assert.throws(()=>resolveIosGatewayRuntime({...env,...change},'staging'));
  }
  assert.equal(resolveIosGatewayRuntime(env,'staging')?.permissionId,env.KICKS_MONITORING_PERMISSION_ID);
});

test('policy requires authenticated KICKS access and exposes only reviewed fields, no gateway credentials',async t=>{
  const identity=new MemoryConsumerIdentityStore(),bindings=new MemoryConsumerDeviceBindingStore(),store=memoryStore();
  const runtime=resolveIosGatewayRuntime(env,'staging')!;
  const enrollment=new IosGatewayEnrollment({identity,bindings,store,leases:new MemoryGatewayLeaseStore()},runtime.config);
  const app=buildServer({store,consumerIdentityStore:identity,consumerDeviceBindingStore:bindings,
    iosGateway:{enrollment,authenticateAuthority:async()=>false}});t.after(()=>app.close());
  const url='/core/consumer/v1/monitoring-policy';
  assert.equal((await app.inject({url})).statusCode,401);
  const account=await identity.createAccount({email:'policy@example.test',password:'Synthetic-Password-2026',terms_version:'one',privacy_version:'one'});
  const session=await identity.issueSessionForSubject(account.account.subject_id);assert.ok(session);
  const response=await app.inject({url,headers:{authorization:'Bearer '+session.access_token}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json(),{policy:{permissionId:env.KICKS_MONITORING_PERMISSION_ID,purpose:env.KICKS_MONITORING_PURPOSE,
    purposeVersion:'one',policyVersion:'one'},collectionEnabled:false});
  assert.doesNotMatch(response.body,/serverHost|publicKey|privateKey|secret|deviceToken/);
  await assert.rejects(enrollment.enroll({accountSubjectId:account.account.subject_id,deviceId:randomUUID(),
    deviceToken:'synthetic-token',permissionId:randomUUID(),publicKey:Buffer.alloc(32,9).toString('base64')}),/monitoring_permission_mismatch/);
});
