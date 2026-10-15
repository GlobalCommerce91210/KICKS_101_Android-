import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, httpsAuthorityReader } from './reconcile.mjs';
const now = Date.parse('2026-10-10T00:00:00Z');
const peer = { publicKey: Buffer.alloc(32,1).toString('base64'), address:'10.88.0.2', addressIPv6:'fd88:4b49:434b::2',
  deviceId:'synthetic', consentId:'grant', purposeVersion:'one',authorization:'active',expiresAt:new Date(now+60_000).toISOString() };
const snapshot = { environment:'staging',collectionEnabled:false,peers:[peer] };
test('replaces complete dual-stack peer set and empty authority removes peer', async () => {
  const writes=[]; const apply=async text=>{writes.push(text);};
  await reconcile({readAuthority:async()=>snapshot,apply,now:()=>now});
  assert.match(writes[0],/AllowedIPs = 10\.88\.0\.2\/32, fd88:4b49:434b::2\/128/);
  await reconcile({readAuthority:async()=>({...snapshot,peers:[]}),apply,now:()=>now});
  assert.doesNotMatch(writes[1],/\[Peer\]/);
});
for (const mode of ['outage','expired','malformed','revoked']) test(`clears previously installed peers on ${mode}`, async () => {
  const writes=[];
  await assert.rejects(reconcile({readAuthority:async()=>{
    if(mode==='outage')throw new Error('offline');
    return {...snapshot,peers:[{...peer,...(mode==='expired'?{expiresAt:new Date(now).toISOString()}:mode==='revoked'?{authorization:'revoked'}:{address:'injection'})}]};
  },apply:async value=>{writes.push(value);},now:()=>now}));
  assert.equal(writes.length,1); assert.doesNotMatch(writes[0],/\[Peer\]/);
});
test('expiration during slow host apply clears peers', async()=>{
  let time=now; const writes=[];
  await assert.rejects(reconcile({readAuthority:async()=>snapshot,apply:async value=>{writes.push(value);time=now+60_001;},now:()=>time}));
  assert.doesNotMatch(writes.at(-1),/\[Peer\]/);
});
test('failed peer clear is a terminal host failure', async()=>{
  await assert.rejects(reconcile({readAuthority:async()=>{throw Error();},apply:async()=>{throw Error();}}),/gateway_peer_clear_failed/);
});
test('authority uses HTTPS, rejects redirects and bounds response',async()=>{
  assert.throws(()=>httpsAuthorityReader({url:'http://example.test',authorization:'synthetic'}));
  const read=httpsAuthorityReader({url:'https://example.test/peers',authorization:'synthetic',fetchImpl:async(_url,init)=>{
    assert.equal(init.redirect,'error');assert.ok(init.signal);return new Response(' '.repeat(128_001));
  }});
  await assert.rejects(read(),/too_large/);
});
