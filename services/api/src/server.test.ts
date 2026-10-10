import test from 'node:test';import assert from 'node:assert/strict';import{buildServer,memoryStore}from'./server.js';import{randomUUID}from'node:crypto';import{IntelligenceEngine}from'./intelligence.js';
const setup=async(options:{intelligenceEngine?:IntelligenceEngine}={})=>{const store=memoryStore(),app=buildServer({store,adminSecret:'staging-secret',...options}),subjectId=randomUUID();const r=await app.inject({method:'POST',url:'/v1/staging/devices',headers:{'x-admin-secret':'staging-secret'},payload:{subjectId}});return{app,store,token:r.json().token as string}};
test('health reports metadata-only staging',async()=>{const app=buildServer(),r=await app.inject({method:'GET',url:'/health'});assert.equal(r.json().collector,'metadata-only');await app.close()});
test('serves web app index.html on root path',async()=>{const app=buildServer(),r=await app.inject({method:'GET',url:'/'});assert.equal(r.statusCode,200);assert.match(r.headers['content-type']??'',/text\/html/);await app.close()});
test('zero trust denies unauthenticated consent writes',async()=>{const app=buildServer(),r=await app.inject({method:'POST',url:'/v1/consent-events',payload:{}});assert.equal(r.statusCode,401);await app.close()});
test('ingestion requires active purpose consent and blocks replay',async()=>{const{app,store,token}=await setup(),permissionId=randomUUID(),headers={authorization:`Bearer ${token}`};const grant=await app.inject({method:'POST',url:'/v1/consent-events',headers,payload:{permissionId,action:'grant',policyVersion:'privacy-1',purposeVersion:'network-safety-1',purpose:'Detect unexpected data destinations'}});const activationId=grant.json().activationId;const payload={batchId:randomUUID(),schemaVersion:'2026-08-01',observations:[{eventId:randomUUID(),occurredAt:new Date().toISOString(),sourceApp:'com.example.app',attribution:'verified',destinationHost:'api.example.com',protocol:'tls',bytesBucket:'1-10KB',classification:'expected',consentId:activationId,consentPurpose:'Detect unexpected data destinations'}]};assert.equal((await app.inject({method:'POST',url:'/v1/metadata-batches',headers,payload})).statusCode,202);assert.equal(store.observations.length,1);assert.equal((await app.inject({method:'POST',url:'/v1/metadata-batches',headers,payload})).statusCode,409);await app.close()});
test('payload fields fail the minimization contract',async()=>{const{app,token}=await setup();const r=await app.inject({method:'POST',url:'/v1/metadata-batches',headers:{authorization:`Bearer ${token}`},payload:{batchId:randomUUID(),schemaVersion:'2026-08-01',observations:[{payload:'secret'}]}});assert.equal(r.statusCode,400);await app.close()});

test('intelligence and value engine endpoints satisfy openapi contract', async () => {
  const { app, token } = await setup();
  const headers = { authorization: `Bearer ${token}` };

  // 1. POST /v1/intelligence/events
  const eventId = 'test-evt-99';
  const postRes = await app.inject({
    method: 'POST',
    headers,
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
        headers,
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
    headers,
    url: `/v1/intelligence/events/${eventId}`
  });
  assert.equal(getEventRes.statusCode, 200);
  assert.equal(getEventRes.json().event_id, eventId);

  // 3. GET /v1/inspector/events/:event_id/metadata
  const getMetaRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/inspector/events/${eventId}/metadata`
  });
  assert.equal(getMetaRes.statusCode, 200);
  assert.equal(getMetaRes.json().event_id, eventId);

  // 4. GET /v1/inspector/apps/:app_id/gates
  const getGatesRes = await app.inject({
    method: 'GET',
    headers,
    url: '/v1/inspector/apps/com.retail.shop/gates'
  });
  assert.equal(getGatesRes.statusCode, 200);
  assert.equal(getGatesRes.json().app_id, 'com.retail.shop');

  // 5. POST /v1/inspector/apps/:app_id/gates
  const updateGatesRes = await app.inject({
    method: 'POST',
    headers,
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
    headers,
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
    headers,
    url: '/v1/intelligence/apps/com.retail.shop/summary'
  });
  assert.equal(summaryRes.statusCode, 200);
  assert.equal(summaryRes.json().app_id, 'com.retail.shop');
  assert.ok(summaryRes.json().average_scores);

  await app.close();
});

test('wallet mechanic endpoints satisfy openapi contract', async () => {
  const intelligenceEngine = new IntelligenceEngine();
  intelligenceEngine.setOffers([{
    offer_id: 'offer-wallet-test-01',
    buyer_id: 'buyer-wallet-test-01',
    buyer_category: 'Research',
    metadata_types: ['commercial', 'intent'],
    pricing_model: { type: 'per_event', min_value_per_event: 10, max_value_per_event: 10 },
    regions_allowed: ['US'],
    consent_required: true,
    status: 'active'
  }]);

  const { app, token } = await setup({ intelligenceEngine });
  const headers = { authorization: `Bearer ${token}` };
  const userId = 'user_wallet_test_01';
  const appId = 'com.example.shop';
  const eventId = 'evt-test-earn-01';

  const summaryRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}`
  });
  assert.equal(summaryRes.statusCode, 200);
  const summary = summaryRes.json();
  assert.equal(summary.total_earned, 0);
  assert.equal(summary.total_pending, 0);
  assert.equal(summary.total_settled, 0);
  assert.ok(summary.earnings_by_app);
  assert.ok(summary.earnings_by_metadata);

  const initialLedgerRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}/ledger?page=1&page_size=10`
  });
  assert.equal(initialLedgerRes.statusCode, 200);
  const initialLedger = initialLedgerRes.json();
  assert.ok(Array.isArray(initialLedger.items));
  assert.equal(initialLedger.items.length, 0);
  assert.equal(initialLedger.page, 1);
  assert.equal(initialLedger.page_size, 10);

  const progressRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}/progress`
  });
  assert.equal(progressRes.statusCode, 200);
  assert.equal(typeof progressRes.json().level, 'number');
  assert.equal(typeof progressRes.json().xp, 'number');

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/apps`,
    payload: { apps: [{
      app_id: appId,
      app_name: 'Shop Test',
      state: 'allowed',
      reason: 'Explicit test permission',
      last_updated: new Date().toISOString()
    }] }
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/apps/${appId}/metadata`,
    payload: { metadata_permissions: [
      { metadata_type: 'commercial', key: 'category', state: 'allowed', last_updated: new Date().toISOString() },
      { metadata_type: 'intent', key: 'purchase_intent', state: 'allowed', last_updated: new Date().toISOString() }
    ] }
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/buyers`,
    payload: { buyers: [{
      buyer_category: 'Research',
      state: 'allowed',
      max_value_band: 100,
      last_updated: new Date().toISOString()
    }] }
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/inspector/apps/${appId}/gates`,
    payload: {
      app_id: appId,
      gates: [
        { metadata_type: 'commercial', default_state: 'allowed' },
        { metadata_type: 'intent', default_state: 'allowed' }
      ]
    }
  })).statusCode, 200);

  const eventRes = await app.inject({
    method: 'POST',
    headers,
    url: '/v1/intelligence/events',
    payload: {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      app_id: appId,
      device_id: 'device-wallet-test-01',
      network: {
        domain: 'analytics.shop.test',
        endpoint: '/track',
        method: 'POST',
        headers: {},
        status_code: 200
      },
      metadata: {
        purchase_intent: 'high',
        category: 'running_shoes'
      },
      tags: ['commercial', 'shopping']
    }
  });
  assert.equal(eventRes.statusCode, 200);

  const earnRes = await app.inject({
    method: 'POST',
    headers,
    url: '/v1/wallet/events/earn',
    payload: { event_id: eventId, user_id: userId }
  });
  assert.equal(earnRes.statusCode, 200);
  const earn = earnRes.json();
  assert.equal(earn.permitted, true);
  assert.equal(earn.ledger_entry.event_id, eventId);
  assert.equal(earn.ledger_entry.permission_state, 'permitted');

  const ledgerRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}/ledger?page=1&page_size=10`
  });
  assert.equal(ledgerRes.statusCode, 200);
  const ledger = ledgerRes.json();
  assert.ok(ledger.items.length > 0);
  assert.ok(ledger.items[0].ledger_id);
  assert.ok(ledger.items[0].wallet_id);

  const appsRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}/apps`
  });
  assert.equal(appsRes.statusCode, 200);
  assert.ok(appsRes.json().earnings_by_app);

  const metaRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}/metadata`
  });
  assert.equal(metaRes.statusCode, 200);
  assert.ok(metaRes.json().earnings_by_metadata);

  const payoutRes = await app.inject({
    method: 'POST',
    headers,
    url: `/v1/wallet/${userId}/payout`,
    payload: { amount: 5, method: 'partner_credit' }
  });
  assert.equal(payoutRes.statusCode, 409);
  assert.equal(payoutRes.json().permitted, false);
  assert.ok(payoutRes.json().denial_reason);

  await app.close();
});
test('permissions control endpoints satisfy openapi contract', async () => {
  const { app, token } = await setup();
  const headers = { authorization: `Bearer ${token}` };

  // 1. GET /v1/permissions/users/:user_id/apps
  const appsRes = await app.inject({
    method: 'GET',
    headers,
    url: '/v1/permissions/users/user_demo_01/apps'
  });
  assert.equal(appsRes.statusCode, 200);
  const appsData = appsRes.json();
  assert.ok(Array.isArray(appsData.apps));
  assert.equal(appsData.apps.length, 0);

  // 2. POST /v1/permissions/users/:user_id/apps
  const updateAppsRes = await app.inject({
    method: 'POST',
    headers,
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
    headers,
    url: '/v1/permissions/users/user_demo_01/apps/com.example.shop/metadata'
  });
  assert.equal(metaRes.statusCode, 200);
  const metaData = metaRes.json();
  assert.ok(Array.isArray(metaData.metadata_permissions));
  assert.ok(metaData.metadata_permissions.length > 0);

  // 4. POST /v1/permissions/users/:user_id/apps/:app_id/metadata
  const updateMetaRes = await app.inject({
    method: 'POST',
    headers,
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
    headers,
    url: '/v1/permissions/users/user_demo_01/buyers'
  });
  assert.equal(buyersRes.statusCode, 200);
  const buyersData = buyersRes.json();
  assert.ok(Array.isArray(buyersData.buyers));

  // 6. POST /v1/permissions/users/:user_id/buyers
  const updateBuyersRes = await app.inject({
    method: 'POST',
    headers,
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
    headers,
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
    headers,
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

test('wallet permissions enforcement: explicit grants allow earnings and later app blocks deny new earnings and payout', async () => {
  const intelligenceEngine = new IntelligenceEngine();
  intelligenceEngine.setOffers([{
    offer_id: 'offer-permission-test-01',
    buyer_id: 'buyer-permission-test-01',
    buyer_category: 'Research',
    metadata_types: ['commercial', 'intent'],
    pricing_model: { type: 'per_event', min_value_per_event: 10, max_value_per_event: 10 },
    regions_allowed: ['US'],
    consent_required: true,
    status: 'active'
  }]);

  const { app, token } = await setup({ intelligenceEngine });
  const headers = { authorization: `Bearer ${token}` };
  const userId = 'user_permission_test_01';
  const appId = 'com.example.shop';

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/apps`,
    payload: { apps: [{
      app_id: appId,
      app_name: 'Shop Test',
      state: 'allowed',
      reason: 'Explicit test permission',
      last_updated: new Date().toISOString()
    }] }
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/apps/${appId}/metadata`,
    payload: { metadata_permissions: [
      { metadata_type: 'commercial', key: 'category', state: 'allowed', last_updated: new Date().toISOString() },
      { metadata_type: 'intent', key: 'purchase_intent', state: 'allowed', last_updated: new Date().toISOString() }
    ] }
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/buyers`,
    payload: { buyers: [{
      buyer_category: 'Research',
      state: 'allowed',
      max_value_band: 100,
      last_updated: new Date().toISOString()
    }] }
  })).statusCode, 200);

  assert.equal((await app.inject({
    method: 'POST',
    headers,
    url: `/v1/inspector/apps/${appId}/gates`,
    payload: {
      app_id: appId,
      gates: [
        { metadata_type: 'commercial', default_state: 'allowed' },
        { metadata_type: 'intent', default_state: 'allowed' }
      ]
    }
  })).statusCode, 200);

  const makeEvent = async (eventId: string) => app.inject({
    method: 'POST',
    headers,
    url: '/v1/intelligence/events',
    payload: {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      app_id: appId,
      device_id: 'device-permission-test-01',
      network: {
        domain: 'analytics.shop.test',
        endpoint: '/track',
        method: 'POST',
        headers: {},
        status_code: 200
      },
      metadata: {
        purchase_intent: 'high',
        category: 'running_shoes'
      },
      tags: ['commercial', 'shopping']
    }
  });

  assert.equal((await makeEvent('evt-perm-test-01')).statusCode, 200);
  assert.equal((await makeEvent('evt-perm-test-02')).statusCode, 200);

  const earnRes1 = await app.inject({
    method: 'POST',
    headers,
    url: '/v1/wallet/events/earn',
    payload: {
      event_id: 'evt-perm-test-01',
      user_id: userId
    }
  });
  assert.equal(earnRes1.statusCode, 200);
  assert.equal(earnRes1.json().permitted, true);
  assert.equal(earnRes1.json().ledger_entry.permission_state, 'permitted');

  const blockAppRes = await app.inject({
    method: 'POST',
    headers,
    url: `/v1/permissions/users/${userId}/apps`,
    payload: {
      apps: [{
        app_id: appId,
        app_name: 'Shop Test',
        state: 'blocked',
        reason: 'Blocked by test enforcement',
        last_updated: new Date().toISOString()
      }]
    }
  });
  assert.equal(blockAppRes.statusCode, 200);

  const earnBlockedAppRes = await app.inject({
    method: 'POST',
    headers,
    url: '/v1/wallet/events/earn',
    payload: {
      event_id: 'evt-perm-test-02',
      user_id: userId
    }
  });
  assert.equal(earnBlockedAppRes.statusCode, 200);
  assert.equal(earnBlockedAppRes.json().permitted, false);
  assert.equal(earnBlockedAppRes.json().ledger_entry.permission_state, 'denied');
  assert.equal(earnBlockedAppRes.json().ledger_entry.status, 'rejected');
  assert.ok(earnBlockedAppRes.json().denial_reason);

  const ledgerRes = await app.inject({
    method: 'GET',
    headers,
    url: `/v1/wallet/${userId}/ledger?page=1&page_size=5`
  });
  assert.equal(ledgerRes.statusCode, 200);
  assert.ok(ledgerRes.json().items.some((i: any) => i.permission_state === 'denied'));

  const payoutDeniedRes = await app.inject({
    method: 'POST',
    headers,
    url: `/v1/wallet/${userId}/payout`,
    payload: {
      amount: 5,
      method: 'bank_transfer'
    }
  });
  assert.equal(payoutDeniedRes.statusCode, 409);
  assert.equal(payoutDeniedRes.json().permitted, false);
  assert.ok(payoutDeniedRes.json().denial_reason);

  await app.close();
});
test('core compliance API is authenticated, fail-closed, consent-aware, and human-review gated', async () => {
  const { app, token } = await setup();
  const headers = { authorization: `Bearer ${token}` };
  const adminHeaders = { ...headers, 'x-admin-secret': 'staging-secret' };

  const unauthenticated = await app.inject({
    method: 'POST',
    url: '/core/compliance/v1/evaluate',
    payload: {
      action: 'blog.publish',
      resource_type: 'blog_post',
      resource_id: 'post-compliance-01'
    }
  });
  assert.equal(unauthenticated.statusCode, 401);

  const noPolicy = await app.inject({
    method: 'POST',
    headers,
    url: '/core/compliance/v1/evaluate',
    payload: {
      action: 'blog.publish',
      resource_type: 'blog_post',
      resource_id: 'post-compliance-01',
      consents: ['content_publish'],
      attributes: { review_channel: 'editorial' }
    }
  });
  assert.equal(noPolicy.statusCode, 200);
  assert.equal(noPolicy.json().outcome, 'deny');
  assert.ok(noPolicy.json().reasons.includes('no_active_policy'));

  const deniedDecisionId = noPolicy.json().decision_id;
  const decisionLookup = await app.inject({
    method: 'GET',
    headers,
    url: `/core/compliance/v1/decisions/${deniedDecisionId}`
  });
  assert.equal(decisionLookup.statusCode, 200);
  assert.equal(decisionLookup.json().decision_id, deniedDecisionId);

  const policiesWithoutAdmin = await app.inject({
    method: 'GET',
    headers,
    url: '/core/compliance/v1/policies'
  });
  assert.equal(policiesWithoutAdmin.statusCode, 403);

  const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
  const policyPayload = {
    policy_id: 'blog-publish-policy',
    version: '1.0.0',
    status: 'active',
    action: 'blog.publish',
    resource_type: 'blog_post',
    required_consents: ['content_publish'],
    required_attributes: { review_channel: 'editorial' },
    human_review: 'required',
    conditions: ['content_must_match_approved_submission'],
    effective_from: effectiveFrom,
    effective_to: null
  };

  const putPolicy = await app.inject({
    method: 'PUT',
    headers: adminHeaders,
    url: '/core/compliance/v1/policies/blog-publish-policy/1.0.0',
    payload: policyPayload
  });
  assert.equal(putPolicy.statusCode, 200);
  assert.equal(putPolicy.json().policy_id, 'blog-publish-policy');

  const missingConsent = await app.inject({
    method: 'POST',
    headers,
    url: '/core/compliance/v1/evaluate',
    payload: {
      action: 'blog.publish',
      resource_type: 'blog_post',
      resource_id: 'post-compliance-02',
      consents: [],
      attributes: { review_channel: 'editorial' }
    }
  });
  assert.equal(missingConsent.statusCode, 200);
  assert.equal(missingConsent.json().outcome, 'deny');
  assert.ok(missingConsent.json().reasons.includes('missing_required_consent:content_publish'));

  const reviewRequired = await app.inject({
    method: 'POST',
    headers,
    url: '/core/compliance/v1/evaluate',
    payload: {
      action: 'blog.publish',
      resource_type: 'blog_post',
      resource_id: 'post-compliance-03',
      consents: ['content_publish'],
      attributes: { review_channel: 'editorial' }
    }
  });
  assert.equal(reviewRequired.statusCode, 200);
  assert.equal(reviewRequired.json().outcome, 'allow_with_conditions');
  assert.equal(reviewRequired.json().human_review_required, true);
  assert.equal(reviewRequired.json().human_review_approved, false);
  assert.ok(reviewRequired.json().conditions.includes('human_review_approval_required'));

  const policies = await app.inject({
    method: 'GET',
    headers: adminHeaders,
    url: '/core/compliance/v1/policies'
  });
  assert.equal(policies.statusCode, 200);
  assert.ok(policies.json().policies.some((p: any) => p.policy_id === 'blog-publish-policy'));

  await app.close();
});
test('blog compliance gateway requires policy, admin review, and compliance authorization before publish', async () => {
  const { app, token } = await setup();
  const headers = { authorization: `Bearer ${token}` };
  const adminHeaders = { ...headers, 'x-admin-secret': 'staging-secret' };

  const policyPayload = {
    policy_id: 'blog-gateway-publish-policy',
    version: '1.0.0',
    status: 'active',
    action: 'blog.publish',
    resource_type: 'blog_post',
    required_consents: ['content_publish'],
    required_attributes: { review_channel: 'editorial' },
    human_review: 'required',
    conditions: ['content_must_match_approved_submission'],
    effective_from: new Date(Date.now() - 60_000).toISOString(),
    effective_to: null
  };

  const putPolicy = await app.inject({
    method: 'PUT',
    headers: adminHeaders,
    url: '/core/compliance/v1/policies/blog-gateway-publish-policy/1.0.0',
    payload: policyPayload
  });
  assert.equal(putPolicy.statusCode, 200);

  const unauthenticatedSubmission = await app.inject({
    method: 'POST',
    url: '/core/blog-gateway/v1/submissions',
    payload: {
      resource_id: 'blog-post-01',
      content_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    }
  });
  assert.equal(unauthenticatedSubmission.statusCode, 401);

  const submissionRes = await app.inject({
    method: 'POST',
    headers,
    url: '/core/blog-gateway/v1/submissions',
    payload: {
      resource_id: 'blog-post-01',
      content_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      consents: ['content_publish'],
      attributes: { review_channel: 'editorial' }
    }
  });
  assert.equal(submissionRes.statusCode, 201);
  const submission = submissionRes.json();
  assert.ok(submission.submission_id);

  const beforeReview = await app.inject({
    method: 'POST',
    headers,
    url: `/core/blog-gateway/v1/submissions/${submission.submission_id}/authorize`
  });
  assert.equal(beforeReview.statusCode, 409);
  assert.equal(beforeReview.json().permitted, false);
  assert.equal(beforeReview.json().outcome, 'allow_with_conditions');
  assert.equal(beforeReview.json().denial_reason, 'human_review_required');

  const clientReviewAttempt = await app.inject({
    method: 'POST',
    headers,
    url: `/core/blog-gateway/v1/submissions/${submission.submission_id}/review`,
    payload: { approved: true }
  });
  assert.equal(clientReviewAttempt.statusCode, 403);

  const adminReview = await app.inject({
    method: 'POST',
    headers: adminHeaders,
    url: `/core/blog-gateway/v1/submissions/${submission.submission_id}/review`,
    payload: { approved: true }
  });
  assert.equal(adminReview.statusCode, 200);
  assert.equal(adminReview.json().approved, true);

  const afterReview = await app.inject({
    method: 'POST',
    headers,
    url: `/core/blog-gateway/v1/submissions/${submission.submission_id}/authorize`
  });
  assert.equal(afterReview.statusCode, 200);
  const authorization = afterReview.json();
  assert.equal(authorization.permitted, true);
  assert.equal(authorization.outcome, 'allow_with_conditions');
  assert.ok(authorization.authorization_id);
  assert.ok(authorization.decision_id);

  const getAuthorization = await app.inject({
    method: 'GET',
    headers,
    url: `/core/blog-gateway/v1/authorizations/${authorization.authorization_id}`
  });
  assert.equal(getAuthorization.statusCode, 200);
  assert.equal(getAuthorization.json().authorization_id, authorization.authorization_id);

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
  assert.equal(data.productName, 'KICK\u2019S');
  assert.equal(data.ownershipLabel, 'A product of DataStorm Inc.');
  assert.equal(data.assetVersion, 'mascot-2026-09-15-01');
  assert.equal(data.minimumAppVersion, '0.2.5');
  assert.equal(data.altText, 'KICK\u2019S orange and gold mascot with blue eyes and glowing data rings');
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
