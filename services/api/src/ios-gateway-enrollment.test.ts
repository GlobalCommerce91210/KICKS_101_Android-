import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import { IosGatewayEnrollment, MemoryGatewayLeaseStore } from './ios-gateway-enrollment.js';

test('staging leases require account ownership, native device proof and current exact consent; authority excludes revocation and expiry', async t => {
  const store=memoryStore(); const identity=new MemoryConsumerIdentityStore(); const bindings=new MemoryConsumerDeviceBindingStore();
  let now=Date.now();
  const config={environment:'staging' as const,serverHost:'gateway.example.test',serverPort:51820,serverPublicKey:Buffer.alloc(32,7).toString('base64'),
    purpose:'Detect unexpected data destinations',purposeVersion:'network-safety-1',policyVersion:'privacy-1'};
  const enrollment=new IosGatewayEnrollment({identity,bindings,store,leases:new MemoryGatewayLeaseStore()},config,()=>now);
  const app=buildServer({store,consumerIdentityStore:identity,consumerDeviceBindingStore:bindings,adminSecret:'synthetic-admin',
    iosGateway:{enrollment,authenticateAuthority:async authorization=>authorization==='Bearer synthetic-authority'}});
  t.after(()=>app.close());
  const account=await app.inject({method:'POST',url:'/core/identity/v1/account',headers:{'idempotency-key':randomUUID()},
    payload:{email:'lease@example.test',password:'Synthetic-Password-2026',terms_version:'terms-1',privacy_version:'privacy-1'}});
  assert.equal(account.statusCode,201);
  const session=await identity.issueSessionForSubject(account.json().account.subject_id); assert.ok(session);
  const headers={authorization:'Bearer '+session.access_token};
  const subjectId=randomUUID();
  const device=await app.inject({method:'POST',url:'/v1/staging/devices',headers:{'x-admin-secret':'synthetic-admin'},payload:{subjectId}});
  const {deviceId,token}=device.json();
  assert.equal((await app.inject({method:'POST',url:'/core/consumer/v1/devices',headers,payload:{device_id:deviceId,device_binding_token:token,platform:'ios'}})).statusCode,201);
  const permissionId=randomUUID();
  const consent={permissionId,activationRequestId:randomUUID(),action:'grant',purpose:config.purpose,purposeVersion:config.purposeVersion,policyVersion:config.policyVersion};
  const leaseUrl=`/core/consumer/v1/devices/${deviceId}/ios-gateway-lease`;
  const input={permissionId,deviceToken:token,publicKey:Buffer.alloc(32,9).toString('base64')};
  assert.equal((await app.inject({method:'POST',url:leaseUrl,headers,payload:input})).statusCode,403);
  const grant=await app.inject({method:'POST',url:`/core/consumer/v1/devices/${deviceId}/consent`,headers,payload:consent});
  assert.equal(grant.statusCode,202);
  assert.equal((await app.inject({method:'POST',url:leaseUrl,payload:input})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:leaseUrl,headers,payload:{...input,deviceToken:'not-a-device-secret'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:leaseUrl,headers,payload:{...input,publicKey:Buffer.alloc(32).toString('base64')}})).statusCode,403);
  const response=await app.inject({method:'POST',url:leaseUrl,headers,payload:input});
  assert.equal(response.statusCode,200); const lease=response.json();
  assert.equal(lease.activationId,grant.json().activationId); assert.equal(lease.collectionEnabled,false);
  assert.equal(Date.parse(lease.expiresAt),now+300_000);
  assert.equal(lease.wireguard.addressIPv4,'10.88.0.2/32'); assert.equal(lease.wireguard.addressIPv6,'fd88:4b49:434b::2/128');
  assert.doesNotMatch(response.body,/privateKey|tokenHash|accountSubjectId|deviceToken/);
  const repeat=await app.inject({method:'POST',url:leaseUrl,headers,payload:input});
  assert.equal(repeat.json().wireguard.addressIPv4,lease.wireguard.addressIPv4);
  const authorityUrl='/internal/staging/ios-gateway/peers';
  assert.equal((await app.inject({url:authorityUrl,headers})).statusCode,401);
  const peerSet=await app.inject({url:authorityUrl,headers:{authorization:'Bearer synthetic-authority'}});
  assert.equal(peerSet.json().peers.length,1); assert.doesNotMatch(peerSet.body,/tokenHash|accountSubjectId|deviceToken/);
  await app.inject({method:'POST',url:`/core/consumer/v1/devices/${deviceId}/consent`,headers,payload:{...consent,activationRequestId:randomUUID(),action:'revoke'}});
  assert.equal((await enrollment.peers()).peers.length,0);
  assert.equal((await app.inject({method:'POST',url:leaseUrl,headers,payload:input})).statusCode,403);
  await app.inject({method:'POST',url:`/core/consumer/v1/devices/${deviceId}/consent`,headers,payload:{...consent,activationRequestId:randomUUID()}});
  // A new grant must not revive the old activation's gateway peer.
  assert.equal((await enrollment.peers()).peers.length,0);
  assert.equal((await app.inject({method:'POST',url:leaseUrl,headers,payload:input})).statusCode,200);
  now+=300_000;
  assert.equal((await enrollment.peers()).peers.length,0);
});

test('lease allocator rejects cross-account reuse and duplicate keys',async()=>{
  const store=new MemoryGatewayLeaseStore();const now=Date.now();
  const lease={accountSubjectId:'a',deviceId:'one',tokenHash:'hash',publicKey:'key',permissionId:'permission',activationId:'activation',purposeVersion:'one',expiresAt:new Date(now+1000).toISOString()};
  await store.upsert(lease,now);
  await assert.rejects(store.upsert({...lease,accountSubjectId:'other'},now),/device_lease_in_use/);
  await assert.rejects(store.upsert({...lease,deviceId:'two'},now),/public_key_in_use/);
});

test('unconfigured gateway does not expose registration or authority',async t=>{
  const app=buildServer({store:memoryStore()});t.after(()=>app.close());
  assert.equal((await app.inject({method:'POST',url:'/core/consumer/v1/devices/synthetic/ios-gateway-lease',payload:{}})).statusCode,503);
  assert.equal((await app.inject({url:'/internal/staging/ios-gateway/peers'})).statusCode,401);
});
