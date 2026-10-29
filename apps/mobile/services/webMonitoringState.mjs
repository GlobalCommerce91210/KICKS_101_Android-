export const WEB_MONITORING_STATES = Object.freeze({
  sign_in_required: 'sign_in_required',
  policy_unavailable: 'policy_unavailable',
  not_connected: 'not_connected',
  fresh_review_required: 'fresh_review_required',
  browser_control_unavailable: 'browser_control_unavailable',
});

export function webMonitoringContextKey({ sessionGeneration = null, accountSubjectId = null, deviceId = null, policy }) {
  return JSON.stringify([sessionGeneration, accountSubjectId, deviceId, policy?.permissionId ?? null, policy?.policyVersion ?? null, policy?.purposeVersion ?? null, policy?.purpose ?? null]);
}

export function createWebRequestGuard() {
  let nonce = 0;
  let disposed = false;
  return {
    begin(context) { const requestNonce = ++nonce; return { nonce: requestNonce, contextKey: webMonitoringContextKey(context) }; },
    snapshot(context, requestNonce) { return { nonce: requestNonce, contextKey: webMonitoringContextKey(context) }; },
    invalidate() { nonce += 1; },
    cleanup() { disposed = true; nonce += 1; },
    isCurrent(request, context) { return !disposed && request.nonce === nonce && request.contextKey === webMonitoringContextKey(context); },
  };
}

export function supersedeWebRequest({ guard, busyRef, setBusy }) {
  guard.invalidate();
  busyRef.current = false;
  setBusy(false);
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
