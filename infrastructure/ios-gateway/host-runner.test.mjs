import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHostInterface, wireGuardHost, runGatewayLoop, clearHostPeers } from './host-runner.mjs';
const key=Buffer.alloc(32,7).toString('base64');
const host=`[Interface]\nPrivateKey = ${key}\nListenPort = 51999\nFwMark = 0xca6c\n\n[Peer]\nPublicKey = old\nAllowedIPs = 10.88.0.5/32\n`;
const peers='[Interface]\nListenPort = 51820\n\n[Peer]\nPublicKey = new\nAllowedIPs = 10.88.0.2/32\n';
test('preserves host key/port/fwmark and replaces all peers',()=>{
  const merged=mergeHostInterface(host,peers);
  assert.match(merged,new RegExp('ListenPort = 51999'));assert.match(merged,/FwMark = 0xca6c/);
  assert.ok(merged.includes(key));assert.doesNotMatch(merged,/old|51820/);
  const cleared=mergeHostInterface(host,'[Interface]\n');assert.ok(cleared.includes(key));assert.doesNotMatch(cleared,/\[Peer\]/);
});
test('rejects uninitialized host and unexpected shell hook fields',()=>{
  assert.throws(()=>mergeHostInterface('[Interface]\nListenPort = 51820\n',peers));
  assert.throws(()=>mergeHostInterface(host.replace('FwMark = 0xca6c','PostUp = command'),peers));
});
test('host uses fixed executable/interface and private exclusive temp file; always removes it',async()=>{
  const calls=[];let saved;
  const run=async(file,args)=>{calls.push([file,args]);return {stdout:host};};
  const io={mkdtemp:async prefix=>{assert.match(prefix,/sync-/);return '/run/kicks-ios-gateway/sync-test';},
    writeFile:async(path,value,options)=>{saved=value;assert.equal(options.mode,0o600);assert.equal(options.flag,'wx');},
    rm:async(path,options)=>{assert.equal(path,'/run/kicks-ios-gateway/sync-test');assert.equal(options.recursive,true);calls.push(['cleanup']);}};
  await wireGuardHost({run,io})(peers);
  assert.deepEqual(calls[0],['/usr/bin/wg',['showconf','kicks-staging']]);
  assert.deepEqual(calls[1],['/usr/bin/wg',['syncconf','kicks-staging','/run/kicks-ios-gateway/sync-test/wireguard.conf']]);
  assert.ok(saved.includes(key));assert.deepEqual(calls[2],['cleanup']);
});
test('host failure still removes private temporary configuration',async()=>{
  let removed=false;
  const apply=wireGuardHost({run:async(_file,args)=>{if(args[0]==='syncconf')throw Error();return {stdout:host};},
    io:{mkdtemp:async()=>'/run/kicks-ios-gateway/sync-test',writeFile:async()=>{},rm:async()=>{removed=true;}}});
  await assert.rejects(apply(peers));assert.equal(removed,true);
});
test('supervisor clear failure disables fixed interface without clearing host key',async()=>{
  const calls=[];await assert.rejects(clearHostPeers({apply:async()=>{throw Error();},run:async(file,args)=>{calls.push([file,args]);}}),/interface_disabled/);
  assert.deepEqual(calls,[['/usr/bin/ip',['link','set','dev','kicks-staging','down']]]);
});
test('loop clears inherited peers, reports health after valid update, clears on termination',async()=>{
  const controller=new AbortController();const writes=[];const notifications=[];
  await runGatewayLoop({readAuthority:async()=>({environment:'staging',collectionEnabled:false,peers:[]}),
    apply:async value=>{writes.push(value);},notify:async state=>{notifications.push(state);},signal:controller.signal,
    pause:async ms=>{assert.equal(ms,1000);controller.abort();}});
  assert.deepEqual(notifications,['ready','watchdog']);assert.equal(writes.length,3);assert.doesNotMatch(writes.at(-1),/\[Peer\]/);
});
test('authority failure does not send watchdog success and terminates after clearing peers',async()=>{
  const writes=[];const notifications=[];
  await assert.rejects(runGatewayLoop({readAuthority:async()=>{throw Error('offline');},apply:async value=>{writes.push(value);},notify:async state=>notifications.push(state)}));
  assert.equal(notifications.length,0);assert.equal(writes.length,3);
});
test('runner reserves watchdog cleanup margin before lease expiry',async()=>{
  const now=Date.now();let reads=0;const writes=[];
  await assert.rejects(runGatewayLoop({now:()=>now,readAuthority:async()=>{reads++;return{environment:'staging',collectionEnabled:false,
    peers:[{expiresAt:new Date(now+29_000).toISOString()}]};},apply:async value=>writes.push(value)}));
  assert.equal(reads,1);assert.ok(writes.every(value=>!value.includes('[Peer]')));
});
