export const WEB_MONITORING_STATES = Object.freeze({
  sign_in_required: 'sign_in_required',
  policy_unavailable: 'policy_unavailable',
  not_connected: 'not_connected',
  fresh_review_required: 'fresh_review_required',
  browser_control_unavailable: 'browser_control_unavailable',
});

export function webMonitoringContextKey({ accountSubjectId, deviceId, policy }) {
  return [accountSubjectId ?? '', deviceId ?? '', policy?.permissionId ?? '', policy?.policyVersion ?? '', policy?.purposeVersion ?? '', policy?.purpose ?? ''].join('|');
}

export function webMonitoringState({ accountSubjectId, deviceId, policyConfigured, freshReview, browserCommandAvailable = false }) {
  if (!accountSubjectId) return WEB_MONITORING_STATES.sign_in_required;
  if (!policyConfigured) return WEB_MONITORING_STATES.policy_unavailable;
  if (!deviceId) return WEB_MONITORING_STATES.not_connected;
  if (!freshReview) return WEB_MONITORING_STATES.fresh_review_required;
  return browserCommandAvailable ? WEB_MONITORING_STATES.browser_control_unavailable : WEB_MONITORING_STATES.browser_control_unavailable;
}

export function shouldResetWebReview(previousContextKey, nextContextKey) {
  return previousContextKey !== nextContextKey;
}
