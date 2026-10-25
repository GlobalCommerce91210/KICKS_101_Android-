const assert = require('node:assert/strict');
const test = require('node:test');
const consent = require('../services/consentApi.ts');

const subjectId = '123e4567-e89b-42d3-a456-426614174000';
const permissionId = consent.stableConsentUuid('test-permission');
const requestId = consent.stableConsentRequestId(permissionId, 0, 'grant', 'privacy-1', 'purpose-1');
const session = { subjectId, deviceToken: 'test-device-token' };
const secureUrl = 'https://consent.example.test';
const validEvent = overrides => ({
  id: '123e4567-e89b-42d3-a456-426614174001',
  permissionId,
  requestId,
  expectedEventSequence: 0,
  action: 'grant',
  policyVersion: 'privacy-1',
  purposeVersion: 'purpose-1',
  purpose: 'Purpose-specific use',
  eventSequence: 1,
  occurredAt: '2026-10-25T00:00:00.000Z',
  ...overrides
});

async function readHistoryWithEvents(events) {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ permissionId, events }), { status: 200 });
  try {
    return await consent.getConsentHistory(secureUrl, session.deviceToken, permissionId);
  } finally {
    global.fetch = originalFetch;
  }
}

test('01 stable consent identities are valid and deterministic UUIDs', () => {
  assert.match(permissionId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(consent.stableConsentUuid('test-permission'), permissionId);
  assert.notEqual(consent.stableConsentUuid('test-permission', 'another'), permissionId);
});

test('02 request IDs are stable for exact sequence and action but change for a new decision', () => {
  assert.equal(consent.stableConsentRequestId(permissionId, 0, 'grant', 'privacy-1', 'purpose-1'), requestId);
  assert.notEqual(consent.stableConsentRequestId(permissionId, 1, 'grant', 'privacy-1', 'purpose-1'), requestId);
  assert.notEqual(consent.stableConsentRequestId(permissionId, 0, 'deny', 'privacy-1', 'purpose-1'), requestId);
});

test('03 consent session is unavailable until a provider supplies a device token and UUID subject', async () => {
  consent.setConsentSessionProvider(null);
  assert.equal(await consent.getConsentSession(), null);
  consent.setConsentSessionProvider(async () => session);
  assert.deepEqual(await consent.getConsentSession(), session);
  consent.setConsentSessionProvider(async () => ({ ...session, subjectId: 'not-a-uuid' }));
  assert.equal(await consent.getConsentSession(), null);
  consent.setConsentSessionProvider(null);
});

test('04 durable history read uses the authenticated history endpoint', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ permissionId, events: [validEvent({})] }), { status: 200 });
  };
  try {
    const result = await consent.getConsentHistory(secureUrl, session.deviceToken, permissionId);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].eventSequence, 1);
    assert.equal(request.url, `${secureUrl}/v1/consent-events/${permissionId}`);
    assert.equal(request.options.headers.authorization, 'Bearer ' + session.deviceToken);
  } finally {
    global.fetch = originalFetch;
  }
});

test('05 history rejects malformed response data rather than inventing an empty ledger', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ permissionId, events: null }), { status: 200 });
  try {
    await assert.rejects(
      consent.getConsentHistory(secureUrl, session.deviceToken, permissionId),
      error => error instanceof consent.ConsentApiError && error.code === 'invalid_history'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('history rejects malformed objects and missing or inconsistent identity fields', async () => {
  const malformedEvents = [
    null,
    validEvent({ permissionId: '123e4567-e89b-42d3-a456-426614174099' }),
    validEvent({ requestId: 'not-a-uuid' }),
    validEvent({ requestId: undefined })
  ];
  for (const event of malformedEvents) {
    await assert.rejects(
      readHistoryWithEvents([event]),
      error => error instanceof consent.ConsentApiError && error.code === 'invalid_history'
    );
  }
});

test('history rejects missing purpose, action, or version fields', async () => {
  const malformedEvents = [
    validEvent({ action: 'allow' }),
    validEvent({ purpose: undefined }),
    validEvent({ purpose: '  ' }),
    validEvent({ policyVersion: undefined }),
    validEvent({ purposeVersion: undefined }),
    validEvent({ policyVersion: '' }),
    validEvent({ purposeVersion: '' })
  ];
  for (const event of malformedEvents) {
    await assert.rejects(
      readHistoryWithEvents([event]),
      error => error instanceof consent.ConsentApiError && error.code === 'invalid_history'
    );
  }
});

test('history rejects missing, discontinuous, or inconsistent event sequences', async () => {
  const malformedHistories = [
    [validEvent({ expectedEventSequence: undefined })],
    [validEvent({ eventSequence: undefined })],
    [validEvent({ expectedEventSequence: 1, eventSequence: 2 })],
    [
      validEvent({}),
      validEvent({
        id: '123e4567-e89b-42d3-a456-426614174002',
        requestId: '123e4567-e89b-42d3-a456-426614174003',
        expectedEventSequence: 2,
        eventSequence: 3
      })
    ]
  ];
  for (const events of malformedHistories) {
    await assert.rejects(
      readHistoryWithEvents(events),
      error => error instanceof consent.ConsentApiError && error.code === 'invalid_history'
    );
  }
});

test('06 history surfaces authentication and service errors', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  try {
    await assert.rejects(
      consent.getConsentHistory(secureUrl, session.deviceToken, permissionId),
      error => error instanceof consent.ConsentApiError && error.status === 401
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('07 history and decisions refuse non-HTTPS service URLs', async () => {
  await assert.rejects(
    consent.getConsentHistory('http://consent.example.test', session.deviceToken, permissionId),
    error => error instanceof consent.ConsentApiError && error.code === 'https_required'
  );
  await assert.rejects(
    consent.recordConsentDecision('http://consent.example.test', session.deviceToken, {
      permissionId, requestId, expectedEventSequence: 0, action: 'grant',
      policyVersion: 'privacy-1', purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
    }),
    error => error instanceof consent.ConsentApiError && error.code === 'https_required'
  );
});

test('08 durable grant request sends the exact stable request ID and expected sequence', async () => {
  const originalFetch = global.fetch;
  let request;
  const decision = {
    permissionId, requestId: consent.stableConsentRequestId(permissionId, 4, 'grant', 'privacy-1', 'purpose-1'),
    expectedEventSequence: 4, action: 'grant',
    policyVersion: 'privacy-1', purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
  };
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      ...decision, id: 'event-id', eventSequence: 5,
      occurredAt: '2026-10-25T00:00:00.000Z', status: 'accepted'
    }), { status: 202 });
  };
  try {
    const saved = await consent.recordConsentDecision(secureUrl, session.deviceToken, decision);
    assert.equal(saved.eventSequence, 5);
    assert.equal(request.url, `${secureUrl}/v1/consent-events`);
    assert.deepEqual(JSON.parse(request.options.body), decision);
    assert.equal(request.options.headers.authorization, 'Bearer ' + session.deviceToken);
  } finally {
    global.fetch = originalFetch;
  }
});

test('09 denied and revoked choices use supported durable action values', async () => {
  const originalFetch = global.fetch;
  const actions = ['deny', 'revoke'];
  const sentActions = [];
  global.fetch = async (_url, options) => {
    const decision = JSON.parse(options.body);
    sentActions.push(decision.action);
    return new Response(JSON.stringify({
      ...decision, id: `event-${decision.action}`, eventSequence: 1,
      occurredAt: '2026-10-25T00:00:00.000Z', status: 'accepted'
    }), { status: 202 });
  };
  try {
    for (const action of actions) {
      await consent.recordConsentDecision(secureUrl, session.deviceToken, {
        permissionId, requestId: consent.stableConsentRequestId(permissionId, 0, action, 'privacy-1', 'purpose-1'),
        expectedEventSequence: 0, action, policyVersion: 'privacy-1',
        purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
      });
    }
    assert.deepEqual(sentActions, actions);
  } finally {
    global.fetch = originalFetch;
  }
});

test('10 stale sequence conflict is returned as a non-retryable server decision', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: 'stale_consent_decision' }), { status: 409 });
  try {
    await assert.rejects(
      consent.recordConsentDecision(secureUrl, session.deviceToken, {
        permissionId, requestId, expectedEventSequence: 0, action: 'grant',
        policyVersion: 'privacy-1', purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
      }),
      error => error instanceof consent.ConsentApiError &&
        error.status === 409 && error.code === 'stale_consent_decision' && !error.retryable
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('11 unconfigured identity and invalid request UUIDs fail closed', async () => {
  await assert.rejects(
    consent.recordConsentDecision(secureUrl, '', {
      permissionId, requestId, expectedEventSequence: 0, action: 'grant',
      policyVersion: 'privacy-1', purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
    }),
    error => error instanceof consent.ConsentApiError && error.code === 'identity_required'
  );
  await assert.rejects(
    consent.recordConsentDecision(secureUrl, session.deviceToken, {
      permissionId, requestId: 'not-a-uuid', expectedEventSequence: 0, action: 'grant',
      policyVersion: 'privacy-1', purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
    }),
    error => error instanceof consent.ConsentApiError && error.code === 'identity_required'
  );
});

test('12 permissions screen is wired only to consent events and never mutates legacy permission truth', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const screen = fs.readFileSync(path.join(__dirname, '../app/permissions.tsx'), 'utf8');
  assert.match(screen, /getConsentHistory/);
  assert.match(screen, /recordConsentDecision/);
  assert.doesNotMatch(screen, /setAppPermissions|setMetadataPermissions|setBuyerPermissions/);
  assert.doesNotMatch(screen, /collectorApi|\.start\(/);
  assert.match(screen, /No permission is assumed/);
});

test('29 transient retries preserve the original idempotency request and exact payload', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const sent = [];
  const decision = {
    permissionId, requestId: consent.stableConsentRequestId(permissionId, 2, 'grant', 'privacy-1', 'purpose-1'),
    expectedEventSequence: 2, action: 'grant',
    policyVersion: 'privacy-1', purposeVersion: 'purpose-1', purpose: 'Purpose-specific use'
  };
  global.setTimeout = callback => {
    callback();
    return 0;
  };
  global.fetch = async (_url, options) => {
    sent.push(JSON.stringify(JSON.parse(options.body)));
    if (sent.length === 1) {
      return new Response(JSON.stringify({ error: 'consent_persistence_unavailable', retryable: true }), {
        status: 503, headers: { 'retry-after': '0' }
      });
    }
    return new Response(JSON.stringify({
      ...decision, id: 'event-id', eventSequence: 3,
      occurredAt: '2026-10-25T00:00:00.000Z', status: 'accepted'
    }), { status: 202 });
  };
  try {
    await consent.recordConsentDecision(secureUrl, session.deviceToken, decision);
    assert.equal(sent.length, 2);
    assert.equal(sent[0], JSON.stringify(decision));
    assert.equal(sent[1], JSON.stringify(decision));
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});
