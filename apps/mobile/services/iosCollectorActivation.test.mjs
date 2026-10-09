import test from 'node:test';
import assert from 'node:assert/strict';
import { activateIosCollector } from './iosCollectorActivation.mjs';
function fixture() {
  const calls = []; let consent = null; let subject = 'account-1';
  const policy = {permissionId:'permission-1',policyVersion:'v1',purposeVersion:'v1',purpose:'existing approved purpose'};
  const native = {
    async getDeviceId(){calls.push('device');return 'this-ipad';}, async prepare(){calls.push('prepare');},
    async requestAuthorization(){calls.push('ios_prompt');return 'authorized';}, async start(){calls.push('start');}, async stop(){calls.push('stop');},
    async getStatus(){return {deviceId:'this-ipad',permissionId:'permission-1',connected:true,consentVerified:true,collecting:true,lastAcceptedObservationAt:new Date().toISOString()};}
  };
  const deps = {subject:()=>subject,policy,native,async disclose(){calls.push('disclosure');return true;},
    async readConsent(){calls.push('read');return consent;},async grantConsent(){calls.push('grant');consent={...policy,action:'grant',deviceId:'this-ipad',subjectId:'account-1'};},onState:state=>calls.push(state)};
  return {calls,deps,set subject(value){subject=value;},set consent(value){consent=value;}};
}
test('disclosure precedes saved consent, OS authorization and verified collection',async()=>{
  const f=fixture();assert.equal((await activateIosCollector(f.deps)).state,'collecting');
  assert.ok(f.calls.indexOf('disclosure')<f.calls.indexOf('grant'));
  assert.ok(f.calls.indexOf('grant')<f.calls.indexOf('ios_prompt'));
  assert.ok(f.calls.indexOf('ios_prompt')<f.calls.indexOf('start'));
  assert.equal(f.calls.filter(x=>x==='read').length,3);
});
test('cancel saves no consent and opens no OS prompt',async()=>{const f=fixture();f.deps.disclose=async()=>false;assert.equal((await activateIosCollector(f.deps)).state,'off');assert.deepEqual(f.calls,[]);});
test('missing native bridge saves no consent',async()=>{const f=fixture();f.deps.native=undefined;await assert.rejects(activateIosCollector(f.deps),/does not include/);assert.deepEqual(f.calls,['disclosure']);});
test('OS rejection does not start',async()=>{const f=fixture();f.deps.native.requestAuthorization=async()=> 'denied';assert.equal((await activateIosCollector(f.deps)).state,'off');assert.ok(!f.calls.includes('start'));});
test('withdrawal during OS prompt prevents startup',async()=>{const f=fixture();f.deps.native.requestAuthorization=async()=>{f.consent=null;return 'authorized';};await assert.rejects(activateIosCollector(f.deps),/withdrawn/);assert.ok(!f.calls.includes('start'));});
test('account change during OS prompt prevents startup',async()=>{const f=fixture();f.deps.native.requestAuthorization=async()=>{f.subject='other';return 'authorized';};await assert.rejects(activateIosCollector(f.deps),/account changed/);assert.ok(!f.calls.includes('start'));});
test('another device consent cannot authorize this iPad',async()=>{const f=fixture();f.deps.grantConsent=async()=>{f.consent={...f.deps.policy,action:'grant',deviceId:'other',subjectId:'account-1'};};await assert.rejects(activateIosCollector(f.deps),/could not be verified/);assert.ok(!f.calls.includes('ios_prompt'));});
test('connected tunnel without new ingestion evidence is not collecting',async()=>{const f=fixture();f.deps.native.getStatus=async()=>({deviceId:'this-ipad',permissionId:'permission-1',connected:true,consentVerified:true,collecting:true,lastAcceptedObservationAt:'2020-01-01T00:00:00Z'});assert.equal((await activateIosCollector(f.deps)).state,'connected_waiting_for_evidence');});
test('unverified status stops tunnel',async()=>{const f=fixture();f.deps.native.getStatus=async()=>({connected:true});await assert.rejects(activateIosCollector(f.deps),/could not be verified/);assert.ok(f.calls.includes('stop'));});
test('failed stop directs user to iOS VPN controls',async()=>{const f=fixture();f.deps.native.getStatus=async()=>null;f.deps.native.stop=async()=>{throw Error('failed');};await assert.rejects(activateIosCollector(f.deps),/iOS Settings/);});
