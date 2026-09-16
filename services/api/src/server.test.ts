import test from 'node:test';import assert from 'node:assert/strict';import{buildServer,memoryStore}from'./server.js';import{randomUUID}from'node:crypto';
const setup=async()=>{const store=memoryStore(),app=buildServer({store,adminSecret:'staging-secret'}),subjectId=randomUUID();const r=await app.inject({method:'POST',url:'/v1/staging/devices',headers:{'x-admin-secret':'staging-secret'},payload:{subjectId}});return{app,store,token:r.json().token as string}};
test('health reports metadata-only staging',async()=>{const app=buildServer(),r=await app.inject({method:'GET',url:'/health'});assert.equal(r.json().collector,'metadata-only');await app.close()});
test('serves web app index.html on root path',async()=>{const app=buildServer(),r=await app.inject({method:'GET',url:'/'});assert.equal(r.statusCode,200);assert.match(r.headers['content-type']??'',/text\/html/);await app.close()});
test('zero trust denies unauthenticated consent writes',async()=>{const app=buildServer(),r=await app.inject({method:'POST',url:'/v1/consent-events',payload:{}});assert.equal(r.statusCode,401);await app.close()});
test('ingestion requires active purpose consent and blocks replay',async()=>{const{app,store,token}=await setup(),permissionId=randomUUID(),headers={authorization:`Bearer ${token}`};await app.inject({method:'POST',url:'/v1/consent-events',headers,payload:{permissionId,action:'grant',policyVersion:'privacy-1',purposeVersion:'network-safety-1',purpose:'Detect unexpected data destinations'}});const payload={batchId:randomUUID(),schemaVersion:'2026-08-01',observations:[{eventId:randomUUID(),occurredAt:new Date().toISOString(),sourceApp:'com.example.app',attribution:'verified',destinationHost:'api.example.com',protocol:'tls',bytesBucket:'1-10KB',classification:'expected',consentId:permissionId,consentPurpose:'Detect unexpected data destinations'}]};assert.equal((await app.inject({method:'POST',url:'/v1/metadata-batches',headers,payload})).statusCode,202);assert.equal(store.observations.length,1);assert.equal((await app.inject({method:'POST',url:'/v1/metadata-batches',headers,payload})).statusCode,409);await app.close()});
test('payload fields fail the minimization contract',async()=>{const{app,token}=await setup();const r=await app.inject({method:'POST',url:'/v1/metadata-batches',headers:{authorization:`Bearer ${token}`},payload:{batchId:randomUUID(),schemaVersion:'2026-08-01',observations:[{payload:'secret'}]}});assert.equal(r.statusCode,400);await app.close()});

test('intelligence and value engine endpoints satisfy openapi contract', async () => {
  const app = buildServer();

  // 1. POST /v1/intelligence/events
  const eventId = 'test-evt-99';
  const postRes = await app.inject({
    method: 'POST',
    url: '/v1/intelligence/events',
    payload: {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      app_id: 'com.retail.shop',
      device_id: 'device-test-01',
      network: {
        domain: 'analytics.adservice.net',
        endpoint: '/track/v1',
        method: 'POST',
        status_code: 200
      },
      metadata: {
        purchase_intent: 'high',
        category: 'running_shoes'
      },
      tags: ['commercial', 'shopping']
    }
  });
  assert.equal(postRes.statusCode, 200);
  const eventView = postRes.json();
  assert.equal(eventView.event_id, eventId);
  assert.equal(eventView.classification.category, 'behavioral_commercial');
  assert.equal(typeof eventView.scores.commercial_intent_score, 'number');
  assert.equal(typeof eventView.scores.metadata_value_estimate, 'number');
  assert.equal(eventView.persona.persona, 'heavy_commercial');
  assert.ok(Array.isArray(eventView.metadata_inspection.metadata_items));

  // 2. GET /v1/intelligence/events/:event_id
  const getEventRes = await app.inject({
    method: 'GET',
    url: `/v1/intelligence/events/${eventId}`
  });
  assert.equal(getEventRes.statusCode, 200);
  assert.equal(getEventRes.json().event_id, eventId);

  // 3. GET /v1/inspector/events/:event_id/metadata
  const getMetaRes = await app.inject({
    method: 'GET',
    url: `/v1/inspector/events/${eventId}/metadata`
  });
  assert.equal(getMetaRes.statusCode, 200);
  assert.equal(getMetaRes.json().event_id, eventId);

  // 4. GET /v1/inspector/apps/:app_id/gates
  const getGatesRes = await app.inject({
    method: 'GET',
    url: '/v1/inspector/apps/com.retail.shop/gates'
  });
  assert.equal(getGatesRes.statusCode, 200);
  assert.equal(getGatesRes.json().app_id, 'com.retail.shop');

  // 5. POST /v1/inspector/apps/:app_id/gates
  const updateGatesRes = await app.inject({
    method: 'POST',
    url: '/v1/inspector/apps/com.retail.shop/gates',
    payload: {
      app_id: 'com.retail.shop',
      gates: [
        {
          metadata_type: 'commercial',
          default_state: 'blocked'
        }
      ]
    }
  });
  assert.equal(updateGatesRes.statusCode, 200);
  assert.equal(updateGatesRes.json().gates[0].default_state, 'blocked');

  // 6. POST /v1/marketplace/match
  const matchRes = await app.inject({
    method: 'POST',
    url: '/v1/marketplace/match',
    payload: {
      app_id: 'com.retail.shop'
    }
  });
  assert.equal(matchRes.statusCode, 200);
  assert.ok(Array.isArray(matchRes.json().matched_offers));

  // 7. GET /v1/intelligence/apps/:app_id/summary
  const summaryRes = await app.inject({
    method: 'GET',
    url: '/v1/intelligence/apps/com.retail.shop/summary'
  });
  assert.equal(summaryRes.statusCode, 200);
  assert.equal(summaryRes.json().app_id, 'com.retail.shop');
  assert.ok(summaryRes.json().average_scores);

  await app.close();
});

test('wallet mechanic endpoints satisfy openapi contract', async () => {
  const app = buildServer({ adminSecret: 'sec' });

  // 1. GET /v1/wallet/:user_id
  const summaryRes = await app.inject({
    method: 'GET',
    url: '/v1/wallet/user_demo_01'
  });
  assert.equal(summaryRes.statusCode, 200);
  const summary = summaryRes.json();
  assert.equal(typeof summary.total_earned, 'number');
  assert.equal(typeof summary.total_pending, 'number');
  assert.equal(typeof summary.total_settled, 'number');
  assert.ok(summary.earnings_by_app);
  assert.ok(summary.earnings_by_metadata);

  // 2. GET /v1/wallet/:user_id/ledger
  const ledgerRes = await app.inject({
    method: 'GET',
    url: '/v1/wallet/user_demo_01/ledger?page=1&page_size=10'
  });
  assert.equal(ledgerRes.statusCode, 200);
  const ledger = ledgerRes.json();
  assert.ok(Array.isArray(ledger.items));
  assert.equal(ledger.page, 1);
  assert.equal(ledger.page_size, 10);
  assert.ok(ledger.items.length > 0);
  assert.ok(ledger.items[0].ledger_id);
  assert.ok(ledger.items[0].wallet_id);

  // 3. GET /v1/wallet/:user_id/progress
  const progressRes = await app.inject({
    method: 'GET',
    url: '/v1/wallet/user_demo_01/progress'
  });
  assert.equal(progressRes.statusCode, 200);
  const progress = progressRes.json();
  assert.equal(typeof progress.level, 'number');
  assert.equal(typeof progress.xp, 'number');
  assert.ok(Array.isArray(progress.milestones_unlocked));
  assert.ok(progress.bonuses);

  // 4. GET /v1/wallet/:user_id/apps
  const appsRes = await app.inject({
    method: 'GET',
    url: '/v1/wallet/user_demo_01/apps'
  });
  assert.equal(appsRes.statusCode, 200);
  assert.ok(appsRes.json().earnings_by_app);

  // 5. GET /v1/wallet/:user_id/metadata
  const metaRes = await app.inject({
    method: 'GET',
    url: '/v1/wallet/user_demo_01/metadata'
  });
  assert.equal(metaRes.statusCode, 200);
  assert.ok(metaRes.json().earnings_by_metadata);

  // 6. POST /v1/wallet/events/earn
  const earnRes = await app.inject({
    method: 'POST',
    url: '/v1/wallet/events/earn',
    payload: {
      event_id: 'evt-test-earn-01',
      user_id: 'user_demo_01'
    }
  });
  assert.equal(earnRes.statusCode, 200);
  const earn = earnRes.json();
  assert.ok(earn.ledger_entry);
  assert.ok(earn.wallet);
  assert.ok(earn.progression_update);
  assert.equal(earn.ledger_entry.event_id, 'evt-test-earn-01');

  // 7. POST /v1/wallet/:user_id/payout
  const payoutRes = await app.inject({
    method: 'POST',
    url: '/v1/wallet/user_demo_01/payout',
    payload: {
      amount: 5.00,
      method: 'partner_credit'
    }
  });
  assert.equal(payoutRes.statusCode, 200);
  const payout = payoutRes.json();
  assert.ok(payout.payout);
  assert.ok(payout.wallet);
  assert.equal(payout.payout.amount, 5.00);
  assert.equal(payout.payout.method, 'partner_credit');
  assert.equal(payout.payout.status, 'completed');

  await app.close();
});

test('permissions control endpoints satisfy openapi contract', async () => {
  const app = buildServer({ adminSecret: 'sec' });

  // 1. GET /v1/permissions/users/:user_id/apps
  const appsRes = await app.inject({
    method: 'GET',
    url: '/v1/permissions/users/user_demo_01/apps'
  });
  assert.equal(appsRes.statusCode, 200);
  const appsData = appsRes.json();
  assert.ok(Array.isArray(appsData.apps));
  assert.ok(appsData.apps.length > 0);
  assert.equal(appsData.apps[0].app_id, 'com.example.shop');

  // 2. POST /v1/permissions/users/:user_id/apps
  const updateAppsRes = await app.inject({
    method: 'POST',
    url: '/v1/permissions/users/user_demo_01/apps',
    payload: {
      apps: [
        {
          app_id: 'com.example.shop',
          app_name: 'Shop Sample',
          state: 'limited',
          reason: 'Restricted by user test',
          last_updated: new Date().toISOString()
        }
      ]
    }
  });
  assert.equal(updateAppsRes.statusCode, 200);
  assert.equal(updateAppsRes.json().apps.find((a: any) => a.app_id === 'com.example.shop').state, 'limited');

  // 3. GET /v1/permissions/users/:user_id/apps/:app_id/metadata
  const metaRes = await app.inject({
    method: 'GET',
    url: '/v1/permissions/users/user_demo_01/apps/com.example.shop/metadata'
  });
  assert.equal(metaRes.statusCode, 200);
  const metaData = metaRes.json();
  assert.ok(Array.isArray(metaData.metadata_permissions));
  assert.ok(metaData.metadata_permissions.length > 0);

  // 4. POST /v1/permissions/users/:user_id/apps/:app_id/metadata
  const updateMetaRes = await app.inject({
    method: 'POST',
    url: '/v1/permissions/users/user_demo_01/apps/com.example.shop/metadata',
    payload: {
      metadata_permissions: [
        {
          metadata_type: 'commercial',
          key: 'category_totals',
          state: 'blocked',
          last_updated: new Date().toISOString()
        }
      ]
    }
  });
  assert.equal(updateMetaRes.statusCode, 200);
  assert.equal(updateMetaRes.json().metadata_permissions.find((m: any) => m.metadata_type === 'commercial').state, 'blocked');

  // 5. GET /v1/permissions/users/:user_id/buyers
  const buyersRes = await app.inject({
    method: 'GET',
    url: '/v1/permissions/users/user_demo_01/buyers'
  });
  assert.equal(buyersRes.statusCode, 200);
  const buyersData = buyersRes.json();
  assert.ok(Array.isArray(buyersData.buyers));

  // 6. POST /v1/permissions/users/:user_id/buyers
  const updateBuyersRes = await app.inject({
    method: 'POST',
    url: '/v1/permissions/users/user_demo_01/buyers',
    payload: {
      buyers: [
        {
          buyer_category: 'AdTech & Behavioral Retargeting',
          state: 'blocked',
          max_value_band: 0,
          last_updated: new Date().toISOString()
        }
      ]
    }
  });
  assert.equal(updateBuyersRes.statusCode, 200);

  // 7. GET /v1/permissions/users/:user_id/effective
  const effectiveRes = await app.inject({
    method: 'GET',
    url: '/v1/permissions/users/user_demo_01/effective'
  });
  assert.equal(effectiveRes.statusCode, 200);
  const effective = effectiveRes.json();
  assert.equal(effective.user_id, 'user_demo_01');
  assert.ok(Array.isArray(effective.apps));
  assert.ok(Array.isArray(effective.metadata_permissions));
  assert.ok(Array.isArray(effective.buyers));

  // 8. GET /v1/permissions/users/:user_id/consent-log
  const logRes = await app.inject({
    method: 'GET',
    url: '/v1/permissions/users/user_demo_01/consent-log?page=1&page_size=10'
  });
  assert.equal(logRes.statusCode, 200);
  const logData = logRes.json();
  assert.ok(Array.isArray(logData.items));
  assert.equal(logData.page, 1);
  assert.ok(logData.items.length > 0);
  assert.ok(logData.items[0].log_id);

  await app.close();
});

test('wallet permissions enforcement: blocked apps, metadata, buyers deny earnings and payouts', async () => {
  const app = buildServer({ adminSecret: 'sec' });

  // 1. Initial earn succeeds
  const earnRes1 = await app.inject({
    method: 'POST',
    url: '/v1/wallet/events/earn',
    payload: {
      event_id: 'evt-perm-test-01',
      user_id: 'user_demo_01'
    }
  });
  assert.equal(earnRes1.statusCode, 200);
  assert.equal(earnRes1.json().permitted, true);
  assert.equal(earnRes1.json().ledger_entry.permission_state, 'permitted');

  // 2. Block the app 'com.example.shop'
  const blockAppRes = await app.inject({
    method: 'POST',
    url: '/v1/permissions/users/user_demo_01/apps',
    payload: {
      apps: [
        {
          app_id: 'com.example.shop',
          app_name: 'Shop Sample',
          state: 'blocked',
          reason: 'Blocked by test enforcement',
          last_updated: new Date().toISOString()
        }
      ]
    }
  });
  assert.equal(blockAppRes.statusCode, 200);

  // 3. Earning from blocked app is denied
  const earnBlockedAppRes = await app.inject({
    method: 'POST',
    url: '/v1/wallet/events/earn',
    payload: {
      event_id: 'evt-perm-test-02',
      user_id: 'user_demo_01'
    }
  });
  assert.equal(earnBlockedAppRes.statusCode, 200);
  assert.equal(earnBlockedAppRes.json().permitted, false);
  assert.equal(earnBlockedAppRes.json().ledger_entry.permission_state, 'denied');
  assert.equal(earnBlockedAppRes.json().ledger_entry.status, 'rejected');
  assert.ok(earnBlockedAppRes.json().denial_reason.includes('blocked by user permission policy'));

  // 4. Ledger reflects denied entry and reason
  const ledgerRes = await app.inject({
    method: 'GET',
    url: '/v1/wallet/user_demo_01/ledger?page=1&page_size=5'
  });
  assert.equal(ledgerRes.statusCode, 200);
  const ledgerItems = ledgerRes.json().items;
  assert.ok(ledgerItems.some((i: any) => i.permission_state === 'denied'));

  // 5. Payout request is denied when earning source app is blocked
  const payoutDeniedRes = await app.inject({
    method: 'POST',
    url: '/v1/wallet/user_demo_01/payout',
    payload: {
      amount: 5.00,
      method: 'bank_transfer'
    }
  });
  assert.equal(payoutDeniedRes.statusCode, 200);
  assert.equal(payoutDeniedRes.json().permitted, false);
  assert.ok(payoutDeniedRes.json().denial_reason);

  await app.close();
});

test('branding endpoints return official brand and mascot specification', async () => {
  const app = buildServer({ adminSecret: 'sec' });

  const res = await app.inject({
    method: 'GET',
    url: '/v1/branding/mascot'
  });
  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.schemaVersion, '1.0');
  assert.equal(data.productName, 'KICK’S');
  assert.equal(data.ownershipLabel, 'A product of DataStorm Inc.');
  assert.equal(data.assetVersion, 'mascot-2026-09-15-01');
  assert.equal(data.minimumAppVersion, '0.2.5');
  assert.equal(data.altText, 'KICK’S orange and gold mascot with blue eyes and glowing data rings');
  assert.ok(data.assets?.primary?.url.includes('mascot-2026-09-15-01.webp'));
  assert.equal(data.assets?.primary?.mimeType, 'image/webp');
  assert.equal(data.assets?.primary?.width, 1024);
  assert.equal(data.assets?.primary?.height, 1024);

  const resGeneral = await app.inject({
    method: 'GET',
    url: '/v1/branding'
  });
  assert.equal(resGeneral.statusCode, 200);
  assert.deepEqual(resGeneral.json(), data);

  await app.close();
});



