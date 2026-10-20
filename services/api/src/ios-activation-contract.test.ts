import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildServer, memoryStore } from './server.js';
import { MemoryConsumerIdentityStore } from './consumer-identity.js';
import { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';
import { MemoryIosDeviceProvisioner } from './ios-device-provisioning.js';
import { IosGatewayEnrollment, MemoryGatewayLeaseStore } from './ios-gateway-enrollment.js';
import { SessionManager } from '../../../apps/mobile/services/sessionCore.js';
import { loadMonitoringPolicy } from '../../../apps/mobile/services/monitoringPolicy.js';
import { activateIosCollector, type BoundCollectorConsent } from '../../../apps/mobile/services/iosCollectorActivation.mjs';
import { enrollCurrentDevice } from '../../../apps/mobile/services/deviceService.mjs';

test('mobile activation crosses real account, native provisioning, consent and gateway routes in order; transport does not imply collection', async t => {
  const identity=new MemoryConsumerIdentityStore(),bindings=new MemoryConsumerDeviceBindingStore(),store=memoryStore();
  const permissionId=randomUUID();
  const config={environment:'staging' as const,serverHost:'gateway.example.test',serverPort:51820,
    serverPublicKey:Buffer.alloc(32,7).toString('base64'),permissionId,
    purpose:'Reviewed synthetic purpose',purposeVersion:'one',policyVersion:'one'};
  const enrollment=new IosGatewayEnrollment({identity,bindings,store,leases:new MemoryGatewayLeaseStore()},config);
  const app=buildServer({store,consumerIdentityStore:identity,consumerDeviceBindingStore:bindings,
    iosDeviceProvisioner:new MemoryIosDeviceProvisioner(store,bindings),
    iosGateway:{enrollment,authenticateAuthority:async()=>false}});t.after(()=>app.close());
  const account=await identity.createAccount({email:'activation@example.test',password:'Synthetic-Password-2026',terms_version:'one',privacy_version:'one'});
  await identity.verifyEmail(account.account.subject_id);
  const transport:typeof fetch=async(url,init={})=>{
    const parsed=new URL(String(url));assert.equal(parsed.origin,'https://staging.example.test');
    const response=await app.inject({method:(init.method??'GET') as 'GET'|'POST'|'DELETE',url:parsed.pathname+parsed.search,
      headers:Object.fromEntries(new Headers(init.headers)),payload:typeof init.body==='string'?init.body:undefined});
    return new Response(response.statusCode===204?null:response.body,{status:response.statusCode});
  };
  const session=new SessionManager({read:async()=>null,write:async()=>{},clear:async()=>{}},()=> 'https://staging.example.test',transport);
  await session.login('activation@example.test','Synthetic-Password-2026');
  const policy=await loadMonitoringPolicy(session);
  const deviceId=randomUUID(),deviceToken=randomBytes(32).toString('base64url'),publicKey=randomBytes(32).toString('base64');
  const requestId=randomUUID(),calls:string[]=[];
  let active=false,lease:Record<string,any>|null=null;
  // This explicitly simulates the native boundary; no OS permission or real tunnel is claimed.
  const native={
    async provision(origin:string,bearer:string,subject:string){
      assert.equal(subject,session.user?.subjectId);calls.push('native_provision');
      const response=await transport(origin+'/core/consumer/v1/ios-devices/provision',{method:'POST',
        headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},
        body:JSON.stringify({requestId,deviceId,deviceToken,publicKey})});
      assert.ok(response.ok);return (await response.json()).deviceId;
    },
    async renewLease(bearer:string,id:string){
      calls.push('lease');const response=await transport('https://staging.example.test/core/consumer/v1/devices/'+deviceId+'/ios-gateway-lease',{
        method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},
        body:JSON.stringify({permissionId:id,deviceToken,publicKey})});
      assert.equal(response.status,200);lease=await response.json();
    },
    async getDeviceId(){return deviceId;},async prepare(){calls.push('prepare');},
    async requestAuthorization(){calls.push('os_approval');assert.ok(lease);return 'authorized';},
    async start(){calls.push('start');active=true;},async stop(){active=false;},
    async getStatus(){return {deviceId,permissionId,activationId:lease?.activationId,expiresAt:lease?.expiresAt,
      connected:active,consentVerified:active&&!!lease,collecting:false};},
  };
  const result=await activateIosCollector({subject:()=>session.user?.subjectId??null,policy,native,
    disclose:async()=>{calls.push('disclosure');return true;},
    provision:async()=>{await enrollCurrentDevice(session,native);},
    renewLease:()=>session.renewIosCollectorLease(native,permissionId),
    readConsent:async()=>{
      const response=await session.request('/core/consumer/v1/devices/'+deviceId+'/consent?permissionId='+permissionId);
      assert.ok(response.ok);const value=await response.json();
      return value.consent?{...value.consent,deviceId,subjectId:session.user!.subjectId} as BoundCollectorConsent:null;
    },
    grantConsent:async()=>{
      calls.push('grant');const response=await session.request('/core/consumer/v1/devices/'+deviceId+'/consent',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...policy,activationRequestId:randomUUID(),action:'grant'})});
      assert.equal(response.status,202);
    },onState:state=>calls.push(state),
  });
  assert.equal(result.state,'connected_waiting_for_evidence');
  assert.ok(calls.indexOf('disclosure')<calls.indexOf('native_provision'));
  assert.ok(calls.indexOf('grant')<calls.indexOf('lease'));
  assert.ok(calls.indexOf('lease')<calls.indexOf('os_approval'));
  assert.ok(calls.indexOf('os_approval')<calls.indexOf('start'));
  assert.equal((await enrollment.peers()).peers.length,1);
  await session.request('/core/consumer/v1/devices/'+deviceId+'/consent',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({...policy,activationRequestId:randomUUID(),action:'revoke'})});
  assert.equal((await enrollment.peers()).peers.length,0);
  await assert.rejects(session.renewIosCollectorLease(native,permissionId));
});
