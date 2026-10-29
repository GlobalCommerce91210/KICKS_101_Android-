import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebRequestGuard, supersedeWebRequest, WEB_MONITORING_STATES, shouldResetWebReview, webMonitoringContextKey, webMonitoringState } from './webMonitoringState.mjs';

const policy = { permissionId: 'permission-1', policyVersion: 'policy-1', purposeVersion: 'purpose-1', purpose: 'reviewed metadata monitoring' };
const context = (overrides = {}) => ({ sessionGeneration: 1, accountSubjectId: 'account-1', deviceId: 'device-1', policy, ...overrides });
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

async function applyGuardedResponse(responsePromise, guard, request, currentContext, writes) {
  if (!guard.isCurrent(request, currentContext())) return;
  const response = await responsePromise;
  if (!guard.isCurrent(request, currentContext())) return;
  const body = await response.json();
  if (!guard.isCurrent(request, currentContext())) return;
  writes.consent = body.consent ?? null;
}

test('web monitoring state never presents browser control as active', () => {
  assert.equal(webMonitoringState({ accountSubjectId: null, deviceId: null, policyConfigured: false, freshReview: false }), WEB_MONITORING_STATES.sign_in_required);
  assert.equal(webMonitoringState({ accountSubjectId: 'account-1', deviceId: null, policyConfigured: true, freshReview: false }), WEB_MONITORING_STATES.not_connected);
  assert.equal(webMonitoringState({ accountSubjectId: 'account-1', deviceId: 'device-1', policyConfigured: true, freshReview: false }), WEB_MONITORING_STATES.fresh_review_required);
  assert.equal(webMonitoringState({ accountSubjectId: 'account-1', deviceId: 'device-1', policyConfigured: true, freshReview: true }), WEB_MONITORING_STATES.browser_control_unavailable);
  assert.equal(webMonitoringState({ accountSubjectId: 'account-1', deviceId: 'device-1', policyConfigured: true, freshReview: true, browserCommandAvailable: true }), WEB_MONITORING_STATES.browser_control_unavailable);
});

test('account, device or policy context changes require fresh review', () => {
  const base = webMonitoringContextKey({ accountSubjectId: 'account-1', deviceId: 'device-1', policy });
  assert.equal(shouldResetWebReview(base, base), false);
  for (const next of [
    webMonitoringContextKey({ accountSubjectId: 'account-2', deviceId: 'device-1', policy }),
    webMonitoringContextKey({ accountSubjectId: 'account-1', deviceId: 'device-2', policy }),
    webMonitoringContextKey({ accountSubjectId: 'account-1', deviceId: 'device-1', policy: { ...policy, policyVersion: 'policy-2' } }),
    webMonitoringContextKey({ accountSubjectId: 'account-1', deviceId: 'device-1', policy: { ...policy, purposeVersion: 'purpose-2' } }),
    webMonitoringContextKey({ accountSubjectId: 'account-1', deviceId: 'device-1', policy: { ...policy, purpose: 'changed reviewed purpose' } }),
  ]) assert.equal(shouldResetWebReview(base, next), true);
});

test('deferred old-device consent cannot overwrite a newer selected device', async () => {
  const guard = createWebRequestGuard(); const writes = { consent: null }; let current = context({ deviceId: '' });
  const oldResponse = deferred();
  const oldRequest = guard.begin(current);
  const selectedRequest = guard.begin(context({ deviceId: 'device-2' })); current = context({ deviceId: 'device-2' });
  const old = applyGuardedResponse(oldResponse.promise, guard, oldRequest, () => current, writes);
  oldResponse.resolve({ async json() { return { consent: { deviceId: 'device-1' } }; } });
  await old;
  assert.equal(writes.consent, null); assert.equal(guard.isCurrent(selectedRequest, current), true);
});

test('deferred response is rejected after account/session context changes', async () => {
  const guard = createWebRequestGuard(); const writes = { consent: null, error: null }; let current = context();
  const response = deferred(); const request = guard.begin(current);
  const pending = applyGuardedResponse(response.promise, guard, request, () => current, writes);
  current = context({ accountSubjectId: 'account-2', sessionGeneration: 2 }); guard.begin(current);
  response.resolve({ async json() { return { consent: { deviceId: 'device-1' } }; } });
  await pending;
  assert.equal(writes.consent, null); assert.equal(writes.error, null);
});

test('invalidation without a replacement clears busy and allows later selection while stale response/error stay ignored', async () => {
  const guard = createWebRequestGuard();
  const writes = { consent: null, error: null, busy: true };
  const busyRef = { current: true };
  const setBusy = value => { writes.busy = value; };
  let current = context();
  const response = deferred();
  const request = guard.begin(current);
  const pendingResponse = applyGuardedResponse(response.promise, guard, request, () => current, writes);
  const failure = deferred();
  const pendingError = failure.promise.catch(error => {
    if (guard.isCurrent(request, current)) writes.error = error.message;
  }).finally(() => {
    if (guard.isCurrent(request, current)) writes.busy = false;
  });

  supersedeWebRequest({ guard, busyRef, setBusy });
  assert.equal(busyRef.current, false);
  assert.equal(writes.busy, false);

  response.resolve({ async json() { return { consent: { deviceId: 'old-device' } }; } });
  failure.reject(new Error('old request failed'));
  await Promise.all([pendingResponse, pendingError]);
  assert.equal(writes.consent, null);
  assert.equal(writes.error, null);

  current = context({ deviceId: 'device-2' });
  assert.equal(busyRef.current, false);
  busyRef.current = true;
  setBusy(true);
  const replacement = guard.begin(current);
  assert.equal(guard.isCurrent(replacement, current), true);
  assert.equal(writes.busy, true);
});

test('stale deferred error cannot clear newer busy state or publish an error', async () => {
  const guard = createWebRequestGuard(); const writes = { busy: true, error: null }; let current = context();
  const response = deferred(); const request = guard.begin(current);
  const pending = response.promise.catch(error => { if (guard.isCurrent(request, current)) writes.error = error.message; }).finally(() => { if (guard.isCurrent(request, current)) writes.busy = false; });
  const newer = guard.begin(context({ deviceId: 'device-2' })); current = context({ deviceId: 'device-2' }); writes.busy = true;
  response.reject(new Error('old device failed')); await pending;
  assert.equal(writes.error, null); assert.equal(writes.busy, true); assert.equal(guard.isCurrent(newer, current), true);
});

test('initial deferred consent cannot overwrite later selection consent', async () => {
  const guard = createWebRequestGuard(); const writes = { consent: null }; let current = context({ deviceId: '' });
  const initialResponse = deferred(); const initialRequest = guard.begin(current);
  const initial = applyGuardedResponse(initialResponse.promise, guard, initialRequest, () => current, writes);
  const selection = guard.begin(context({ deviceId: 'device-2' })); current = context({ deviceId: 'device-2' });
  writes.consent = { deviceId: 'device-2' };
  initialResponse.resolve({ async json() { return { consent: { deviceId: 'device-1' } }; } });
  await initial;
  assert.deepEqual(writes.consent, { deviceId: 'device-2' }); assert.equal(guard.isCurrent(selection, current), true);
});

test('JSON context tuple prevents delimiter collisions', () => {
  const left = webMonitoringContextKey({ accountSubjectId: 'a|b', deviceId: 'c', policy });
  const right = webMonitoringContextKey({ accountSubjectId: 'a', deviceId: 'b|c', policy });
  assert.notEqual(left, right);
});
