import test from 'node:test';
import assert from 'node:assert/strict';
import { activateIosCollector, isCanonicalUuid, isCompleteCollectorStatus, verifiedCollectorConnection, verifiedCollectorStopped } from './iosCollectorActivation.mjs';
function fixture() {
  const calls = []; let consent = null; let subject = 'account-1';
  const policy = {permissionId:'permission-1',policyVersion:'v1',purposeVersion:'v1',purpose:'existing approved purpose'};
  const native = {
    async getDeviceId(){calls.push('device');return 'this-ipad';}, async prepare(){calls.push('prepare');},
    async requestAuthorization(){calls.push('ios_prompt');return 'authorized';}, async start(){calls.push('start');}, async stop(){calls.push('stop');},
    async getStatus(){return calls.includes('stop') ? { connected:false, consentVerified:false, collecting:false } : {deviceId:'this-ipad',permissionId:'permission-1',activationId:'activation-1',expiresAt:new Date(Date.now()+240_000).toISOString(),connected:true,consentVerified:true,collecting:true,lastAcceptedObservationAt:new Date().toISOString()};}
  };
  const deps = {subject:()=>subject,policy,native,async disclose(){calls.push('disclosure');return true;},
    async readConsent(){calls.push('read');return consent;},newActivationRequestId:()=> '00000000-0000-4000-8000-000000000001',async grantConsent(){calls.push('grant');consent={...policy,action:'grant',activationId:'activation-1',deviceId:'this-ipad',subjectId:'account-1'};},onState:state=>calls.push(state),wait:async()=>{}};
  return {calls,deps,set subject(value){subject=value;},set consent(value){consent=value;}};
}

test('unavailable runtime verification prevents provisioning, grants, leases and VPN approval', async () => {
  const f = fixture(); f.deps.native.getStatus = async () => ({ unavailableReason: 'Native verification unavailable. Request a verified staging build.' });
  f.deps.provision = async () => { f.calls.push('provision'); };
  f.deps.renewLease = async () => { f.calls.push('lease'); };
  await assert.rejects(activateIosCollector(f.deps), /verification unavailable/);
  assert.deepEqual(f.calls, ['disclosure']);
});
test('disclosure precedes saved consent, OS authorization and verified collection',async()=>{
  const f=fixture();assert.equal((await activateIosCollector(f.deps)).state,'collecting');
  assert.ok(f.calls.indexOf('disclosure')<f.calls.indexOf('grant'));
  assert.ok(f.calls.indexOf('grant')<f.calls.indexOf('ios_prompt'));
  assert.ok(f.calls.indexOf('ios_prompt')<f.calls.indexOf('start'));
  assert.equal(f.calls.filter(x=>x==='read').length,4);
});
test('cancel saves no consent and opens no OS prompt',async()=>{const f=fixture();f.deps.disclose=async()=>false;assert.equal((await activateIosCollector(f.deps)).state,'off');assert.deepEqual(f.calls,[]);});
test('missing native bridge saves no consent',async()=>{const f=fixture();f.deps.native=undefined;await assert.rejects(activateIosCollector(f.deps),/does not include/);assert.deepEqual(f.calls,['disclosure']);});
test('OS rejection does not start',async()=>{const f=fixture();f.deps.native.requestAuthorization=async()=> 'denied';assert.equal((await activateIosCollector(f.deps)).state,'off');assert.ok(!f.calls.includes('start'));});
test('withdrawal during OS prompt prevents startup',async()=>{const f=fixture();f.deps.native.requestAuthorization=async()=>{f.consent=null;return 'authorized';};await assert.rejects(activateIosCollector(f.deps),/withdrawn/);assert.ok(!f.calls.includes('start'));});
test('account change during OS prompt prevents startup',async()=>{const f=fixture();f.deps.native.requestAuthorization=async()=>{f.subject='other';return 'authorized';};await assert.rejects(activateIosCollector(f.deps),/account changed/);assert.ok(!f.calls.includes('start'));});
test('another device consent cannot authorize this iPad',async()=>{const f=fixture();f.deps.grantConsent=async()=>{f.consent={...f.deps.policy,action:'grant',deviceId:'other',subjectId:'account-1'};};await assert.rejects(activateIosCollector(f.deps),/could not be verified/);assert.ok(!f.calls.includes('ios_prompt'));});
test('connected tunnel without new ingestion evidence is not collecting',async()=>{const f=fixture();const status=f.deps.native.getStatus;f.deps.native.getStatus=async()=>({...await status(),lastAcceptedObservationAt:'2020-01-01T00:00:00Z'});assert.equal((await activateIosCollector(f.deps)).state,'connected_waiting_for_evidence');});
test('unverified status stops tunnel',async()=>{const f=fixture();f.deps.native.getStatus=async()=>f.calls.includes('stop')?{connected:false,consentVerified:false,collecting:false}:{connected:true,consentVerified:false,collecting:false};await assert.rejects(activateIosCollector(f.deps),/could not be verified/);assert.ok(f.calls.includes('stop'));});
test('failed stop directs user to iOS VPN controls',async()=>{const f=fixture();let started=false;const status=f.deps.native.getStatus;f.deps.native.start=async()=>{started=true;};f.deps.native.getStatus=async()=>started?null:status();f.deps.native.stop=async()=>{throw Error('failed');};await assert.rejects(activateIosCollector(f.deps),/iOS Settings/);});

test('native provisioning follows disclosure and lease follows verified grant', async () => {
  const f = fixture();
  f.deps.provision = async () => { f.calls.push('provision'); };
  f.deps.renewLease = async () => { f.calls.push('lease'); };
  await activateIosCollector(f.deps);
  assert.ok(f.calls.indexOf('disclosure') < f.calls.indexOf('provision'));
  assert.ok(f.calls.indexOf('provision') < f.calls.indexOf('device'));
  assert.ok(f.calls.indexOf('grant') < f.calls.indexOf('lease'));
  assert.ok(f.calls.indexOf('lease') < f.calls.indexOf('ios_prompt'));
});
test('account change during native provisioning prevents consent and VPN prompt', async () => {
  const f = fixture(); f.deps.provision = async () => { f.subject = 'other'; };
  await assert.rejects(activateIosCollector(f.deps), /account changed/);
  assert.ok(!f.calls.includes('grant')); assert.ok(!f.calls.includes('ios_prompt'));
});
test('withdrawal during lease request prevents OS authorization', async () => {
  const f = fixture(); f.deps.renewLease = async () => { f.consent = null; };
  await assert.rejects(activateIosCollector(f.deps), /withdrawn/);
  assert.ok(!f.calls.includes('ios_prompt')); assert.ok(!f.calls.includes('start'));
});
test('native enrollment failure leaves collection off without saving consent', async () => {
  const f = fixture(); f.deps.provision = async () => { throw Error('enrollment denied'); };
  await assert.rejects(activateIosCollector(f.deps), /enrollment denied/);
  assert.ok(!f.calls.includes('grant')); assert.ok(!f.calls.includes('start'));
});

test('startup waits through asynchronous OS connection and provider verification', async () => {
  const f = fixture(); const status = f.deps.native.getStatus; let reads = 0;
  f.deps.native.getStatus = async () => {
    if (!f.calls.includes('start')) return { connected: false, consentVerified: false, collecting: false };
    return ++reads < 3 ? { connected: true, consentVerified: false, collecting: false } : status();
  };
  f.deps.wait = async () => { f.calls.push('wait'); };
  assert.equal((await activateIosCollector(f.deps)).state, 'collecting');
  assert.equal(f.calls.filter(call => call === 'wait').length, 2);
});

test('extension evidence must match device, permission, activation and bounded unexpired lease', async () => {
  const f = fixture(); await f.deps.grantConsent(); const consent = await f.deps.readConsent();
  const good = await f.deps.native.getStatus();
  assert.equal(verifiedCollectorConnection(good, consent), true);
  for (const change of [{ deviceId: 'another' }, { permissionId: 'another' }, { activationId: 'old' },
    { expiresAt: 'invalid' }, { expiresAt: new Date(Date.now()-1).toISOString() },
    { expiresAt: new Date(Date.now()+600_000).toISOString() }, { consentVerified: false }, { connected: false }]) {
    assert.equal(verifiedCollectorConnection({ ...good, ...change }, consent), false);
  }
});

test('a new grant during the VPN prompt cannot authorize the old lease', async () => {
  const f = fixture(); f.deps.native.requestAuthorization = async () => {
    f.consent = { ...f.deps.policy, action: 'grant', activationId: 'new-activation', deviceId: 'this-ipad', subjectId: 'account-1' };
    return 'authorized';
  };
  await assert.rejects(activateIosCollector(f.deps), /withdrawn or changed/);
  assert.ok(!f.calls.includes('start'));
});

test('revocation or account change while connecting stops and verifies the VPN', async () => {
  for (const change of ['revoke', 'account']) {
    const f = fixture(); const status = f.deps.native.getStatus;
    f.deps.native.getStatus = async () => f.calls.includes('start') && !f.calls.includes('stop') ? { connected: true, consentVerified: false, collecting: false } : status();
    f.deps.wait = async () => { if (change === 'revoke') f.consent = null; else f.subject = 'another'; };
    await assert.rejects(activateIosCollector(f.deps), /withdrawn|account changed/);
    assert.ok(f.calls.includes('stop'));
  }
});

test('connected transport without accepted observations stays waiting', async () => {
  const f = fixture(); const status = f.deps.native.getStatus;
  f.deps.native.getStatus = async () => ({ ...await status(), collecting: false, lastAcceptedObservationAt: undefined });
  assert.equal((await activateIosCollector(f.deps)).state, 'connected_waiting_for_evidence');
});

test('a stop call returning success cannot hide an active VPN after failed verification', async () => {
  const f = fixture(); f.deps.native.getStatus = async () => ({ connected: true, consentVerified: false, collecting: false });
  await assert.rejects(activateIosCollector(f.deps), /stop could not be confirmed/);
});

test('missing policy or activation cannot cause a lease request or VPN prompt', async () => {
  const f = fixture(); f.deps.policy.purpose = '';
  await assert.rejects(activateIosCollector(f.deps), /not configured/);
  assert.deepEqual(f.calls, []);
  const g = fixture(); g.deps.grantConsent = async () => { g.consent = { ...g.deps.policy, action:'grant', deviceId:'this-ipad', subjectId:'account-1' }; };
  await assert.rejects(activateIosCollector(g.deps), /could not be verified/);
  assert.ok(!g.calls.includes('ios_prompt'));
});


test('matching saved grant is never reused; fresh activation request is required', async () => {
  const f = fixture(); const requests = [];
  f.consent = { ...f.deps.policy, action:'grant', activationId:'old-activation', deviceId:'this-ipad', subjectId:'account-1' };
  f.deps.newActivationRequestId = () => '00000000-0000-4000-8000-000000000002';
  f.deps.grantConsent = async (deviceId, requestId) => {
    requests.push({ deviceId, requestId });
    f.consent = { ...f.deps.policy, action:'grant', activationId:'new-activation', deviceId, subjectId:'account-1' };
  };
  f.deps.native.getStatus = async () => ({ deviceId:'this-ipad', permissionId:'permission-1', activationId:'new-activation', expiresAt:new Date(Date.now()+240_000).toISOString(), connected:true, consentVerified:true, collecting:true, lastAcceptedObservationAt:new Date().toISOString() });
  await activateIosCollector(f.deps);
  assert.deepEqual(requests, [{ deviceId:'this-ipad', requestId:'00000000-0000-4000-8000-000000000002' }]);
});

test('unchanged activation is denied before lease renewal or OS prompt', async () => {
  const f = fixture(); f.consent = { ...f.deps.policy, action:'grant', activationId:'old-activation', deviceId:'this-ipad', subjectId:'account-1' };
  f.deps.renewLease = async () => { f.calls.push('lease'); };
  f.deps.grantConsent = async () => { f.calls.push('grant'); };
  await assert.rejects(activateIosCollector(f.deps), /Fresh consent/);
  assert.ok(!f.calls.includes('lease')); assert.ok(!f.calls.includes('ios_prompt')); assert.ok(!f.calls.includes('start'));
});

test('canceled restart does not submit a replacement grant', async () => {
  const f = fixture(); f.consent = { ...f.deps.policy, action:'grant', activationId:'old-activation', deviceId:'this-ipad', subjectId:'account-1' };
  f.deps.disclose = async () => false;
  await assert.doesNotReject(async () => { assert.equal((await activateIosCollector(f.deps)).state, 'off'); });
  assert.ok(!f.calls.includes('grant')); assert.ok(!f.calls.includes('ios_prompt'));
});

test('failed fresh grant has no saved-grant fallback', async () => {
  const f = fixture(); f.consent = { ...f.deps.policy, action:'grant', activationId:'old-activation', deviceId:'this-ipad', subjectId:'account-1' };
  f.deps.grantConsent = async () => { f.calls.push('grant_failed'); throw new Error('grant rejected'); };
  await assert.rejects(activateIosCollector(f.deps), /grant rejected/);
  assert.ok(!f.calls.includes('ios_prompt')); assert.ok(!f.calls.includes('start'));
});

test('lease renewal must preserve the fresh activation', async () => {
  const f = fixture();
  f.deps.grantConsent = async (deviceId) => { f.consent = { ...f.deps.policy, action:'grant', activationId:'fresh-activation', deviceId, subjectId:'account-1' }; };
  f.deps.renewLease = async () => { f.consent = { ...f.consent, activationId:'different-activation' }; };
  await assert.rejects(activateIosCollector(f.deps), /withdrawn or changed/);
  assert.ok(!f.calls.includes('ios_prompt')); assert.ok(!f.calls.includes('start'));
});

test('successful stop and restart require distinct activations', async () => {
  const f = fixture(); let generation = 0; let stopped = false; let latestActivation = null;
  f.deps.grantConsent = async (deviceId) => {
    generation += 1;
    latestActivation = `activation-${generation}`;
    f.consent = { ...f.deps.policy, action:'grant', activationId:latestActivation, deviceId, subjectId:'account-1' };
  };
  f.deps.native.getStatus = async () => stopped ? { connected:false, consentVerified:false, collecting:false } : {
    deviceId:'this-ipad', permissionId:'permission-1', activationId:latestActivation,
    expiresAt:new Date(Date.now()+240_000).toISOString(), connected:true, consentVerified:true,
    collecting:true, lastAcceptedObservationAt:new Date().toISOString()
  };
  assert.equal((await activateIosCollector(f.deps)).state, 'collecting');
  await f.deps.native.stop(); stopped = true;
  assert.equal(verifiedCollectorStopped(await f.deps.native.getStatus()), true);
  stopped = false;
  assert.equal((await activateIosCollector(f.deps)).state, 'collecting');
  assert.equal(generation, 2); assert.equal(latestActivation, 'activation-2');
});

test('incomplete or unavailable stop status remains unknown', () => {
  for (const status of [null, {}, { connected:false }, { collecting:false },
    { unavailableReason:'offline', connected:false, collecting:false },
    { connected:true, collecting:false }, { connected:false, collecting:true }]) {
    assert.equal(verifiedCollectorStopped(status), false);
  }
  assert.equal(verifiedCollectorStopped({ connected:false, consentVerified:false, collecting:false }), true);
});


test('invalid activation request ID fails closed before grant', async () => {
  const f = fixture(); let lease = false; let provision = false;
  f.deps.newActivationRequestId = () => 'activation-not-a-uuid';
  f.deps.provision = async () => { provision = true; };
  f.deps.renewLease = async () => { lease = true; };
  await assert.rejects(activateIosCollector(f.deps), /valid activation request ID/);
  assert.equal(provision, true); assert.equal(lease, false);
  assert.ok(!f.calls.includes('grant')); assert.ok(!f.calls.includes('ios_prompt')); assert.ok(!f.calls.includes('start'));
});

test('null or partial initial status blocks all side effects after status read', async () => {
  for (const status of [null, {}, { connected:false, collecting:false }, { connected:false, consentVerified:false }]) {
    const f = fixture(); let provision = false; let lease = false;
    f.deps.native.getStatus = async () => status;
    f.deps.provision = async () => { provision = true; };
    f.deps.renewLease = async () => { lease = true; };
    await assert.rejects(activateIosCollector(f.deps), /unavailable|incomplete/);
    assert.equal(provision, false); assert.equal(lease, false);
    assert.ok(!f.calls.includes('device')); assert.ok(!f.calls.includes('prepare')); assert.ok(!f.calls.includes('grant')); assert.ok(!f.calls.includes('ios_prompt'));
  }
});

test('deferred OS authorization cancellation prevents a late native start', async () => {
  const f = fixture(); let canceled = false; let resolveAuthorization;
  const authorization = new Promise(resolve => { resolveAuthorization = resolve; });
  f.deps.isCanceled = () => canceled;
  f.deps.native.requestAuthorization = async () => { f.calls.push('ios_prompt'); return authorization; };
  const pending = activateIosCollector(f.deps);
  for (let i = 0; i < 20 && !f.calls.includes('ios_prompt'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.includes('ios_prompt'));
  canceled = true; resolveAuthorization('authorized');
  assert.equal((await pending).state, 'off');
  assert.ok(!f.calls.includes('start'));
});

test('cancellation after native start verifies cleanup before returning off', async () => {
  const f = fixture(); let canceled = false; let resolveStart; let stopped = false;
  const startCompletion = new Promise(resolve => { resolveStart = resolve; });
  f.deps.isCanceled = () => canceled;
  f.deps.native.start = async () => { f.calls.push('start'); await startCompletion; };
  f.deps.native.stop = async () => { f.calls.push('stop'); stopped = true; };
  f.deps.native.getStatus = async () => stopped ? { connected:false, consentVerified:false, collecting:false } : {
    deviceId:'this-ipad', permissionId:'permission-1', activationId:'activation-1', expiresAt:new Date(Date.now()+240_000).toISOString(), connected:true, consentVerified:true, collecting:true, lastAcceptedObservationAt:new Date().toISOString()
  };
  const pending = activateIosCollector(f.deps);
  for (let i = 0; i < 20 && !f.calls.includes('start'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.includes('start')); canceled = true; resolveStart();
  assert.equal((await pending).state, 'off');
  assert.ok(f.calls.includes('stop')); assert.equal(verifiedCollectorStopped(await f.deps.native.getStatus()), true);
});

test('status and request ID validators accept only canonical values', () => {
  assert.equal(isCanonicalUuid('00000000-0000-4000-8000-000000000001'), true);
  assert.equal(isCanonicalUuid('activation-1'), false);
  assert.equal(isCompleteCollectorStatus({ connected:false, consentVerified:false, collecting:false }), true);
  assert.equal(isCompleteCollectorStatus({ connected:false, collecting:false }), false);
});
