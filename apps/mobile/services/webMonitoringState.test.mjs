import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_MONITORING_STATES, shouldResetWebReview, webMonitoringContextKey, webMonitoringState } from './webMonitoringState.mjs';

const policy = { permissionId: 'permission-1', policyVersion: 'policy-1', purposeVersion: 'purpose-1', purpose: 'reviewed metadata monitoring' };

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
