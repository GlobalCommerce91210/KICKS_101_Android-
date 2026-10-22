import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, parseResponse, validWallet, ApiError } from './requestState.mjs';
const wallet = { total_earned: 0, total_pending: 0, total_settled: 0 };
const validate = value => Array.isArray(value?.items);
test('populated and successful empty responses remain distinct from errors; real zero survives', async () => {
  assert.deepEqual(await parseResponse(Response.json(wallet), validWallet), wallet);
  for (const items of [[], [{ id: 1 }]]) assert.deepEqual(await parseResponse(Response.json({ items }), validate), { items });
});
for (const [status, state] of [[401,'UNAUTHORIZED'],[403,'UNAUTHORIZED'],[404,'UNAVAILABLE'],[429,'UNAVAILABLE'],[500,'UNAVAILABLE'],[503,'UNAVAILABLE']]) {
  test(`HTTP ${status} maps to ${state}`, async () => {
    await assert.rejects(parseResponse(Response.json({}, { status }), validate), e => e.state === state && e.status === status);
  });
}
test('malformed JSON and missing wallet fields never become successful zero balances', async () => {
  for (const response of [new Response('<html>'), Response.json({}), Response.json({ ...wallet, total_earned: '0' })])
    await assert.rejects(parseResponse(response, validWallet), ApiError);
});
test('429/503 safe GET retries are bounded; server long Retry-After is honored without early retry', async () => {
  for (const status of [429,503]) {
    let calls = 0; const waits = [];
    const send = createTransport(async () => { calls++; return Response.json({}, { status }); }, { delay: async ms => waits.push(ms) });
    assert.equal((await send('https://test')).status,status); assert.equal(calls,3); assert.deepEqual(waits,[250,500]);
  }
  let calls = 0;
  await createTransport(async () => { calls++; return new Response('',{status:429,headers:{'retry-after':'60'}}); })('https://test');
  assert.equal(calls,1);
});
test('mutations, 401, 403 and 404 never retry', async () => {
  for (const [method,status] of [['POST',503],['DELETE',500],['GET',401],['GET',403],['GET',404]]) {
    let calls = 0;
    const send = createTransport(async () => { calls++; return Response.json({}, {status}); });
    await send('https://test',{method}); assert.equal(calls,1);
  }
});
test('offline and timeout fail without retry loops, then service restoration recovers', async () => {
  let offline = true;
  const send = createTransport(async () => { if (offline) throw new TypeError('secret-host'); return Response.json(wallet); });
  await assert.rejects(send('https://test'), e => e.state === 'UNAVAILABLE' && !e.message.includes('secret-host'));
  offline = false; assert.deepEqual(await parseResponse(await send('https://test'),validWallet),wallet);
  const timeout = createTransport((_url,init) => new Promise((_resolve,reject) => init.signal.addEventListener('abort',() => reject(new Error('abort')))),{timeoutMs:5});
  await assert.rejects(timeout('https://test'),ApiError);
});
test('concurrent GETs share a request with independently consumable bodies; credentials isolate flights', async () => {
  let calls=0;
  const send=createTransport(async () => { calls++; await new Promise(r=>setTimeout(r,5)); return Response.json(wallet); });
  const responses=await Promise.all([send('https://test'),send('https://test')]);
  assert.equal(calls,1); for(const response of responses) assert.deepEqual(await response.json(),wallet);
  await Promise.all([send('https://test',{headers:{authorization:'a'}}),send('https://test',{headers:{authorization:'b'}})]); assert.equal(calls,3);
});
test('diagnostics contain only correlation ID, status and attempt',async()=>{
  const events=[];
  const send=createTransport(async (_url,init)=>{ assert.match(init.headers.get('x-request-id'),/^req-/); return Response.json(wallet); },{diagnostic:event=>events.push(event)});
  await send('https://private/account/subject',{headers:{authorization:'secret'}});
  assert.deepEqual(Object.keys(events[0]).sort(),['attempt','requestId','status']);
  assert.ok(!JSON.stringify(events).includes('secret')); assert.ok(!JSON.stringify(events).includes('subject'));
});

test('stale cache is bounded, identity scoped and never reused after account replacement',async()=>{
  const { visibleCache }=await import('./requestState.mjs');
  const account={}; const cache={account,data:wallet,at:1000};
  assert.equal(visibleCache(cache,account,2000),wallet);
  assert.equal(visibleCache(cache,{},2000),null);
  assert.equal(visibleCache(cache,null,2000),null);
  assert.equal(visibleCache(cache,account,301000),null);
  assert.equal(visibleCache(cache,account,999),null);
});

test('in-memory diagnostics include network failures and remain bounded without URLs or identities',async()=>{
  const { getRequestDiagnostics }=await import('./requestState.mjs');
  const send=createTransport(async()=>{throw new Error('private')});
  for(let i=0;i<55;i++) await assert.rejects(send('https://secret.test/account'),ApiError);
  const events=getRequestDiagnostics(); assert.equal(events.length,50);
  assert.ok(events.every(event=>event.status===null));
  assert.ok(!JSON.stringify(events).includes('secret'));
});

test('Cloudflare HTML 403 is service unavailability, not a consumer permission decision', async () => {
  await assert.rejects(parseResponse(new Response('<html>challenge</html>',{status:403,headers:{'content-type':'text/html','cf-mitigated':'challenge'}}),validWallet), e => e.state === 'UNAVAILABLE' && e.status === 403);
});
