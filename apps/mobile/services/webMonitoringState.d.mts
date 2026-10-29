export declare const WEB_MONITORING_STATES: Readonly<{
  sign_in_required: 'sign_in_required';
  policy_unavailable: 'policy_unavailable';
  not_connected: 'not_connected';
  fresh_review_required: 'fresh_review_required';
  browser_control_unavailable: 'browser_control_unavailable';
}>;
export interface WebMonitoringPolicyIdentity { permissionId?: string; policyVersion?: string; purposeVersion?: string; purpose?: string; }
export function webMonitoringContextKey(input: { accountSubjectId?: string | null; deviceId?: string | null; policy?: WebMonitoringPolicyIdentity | null }): string;
export function webMonitoringState(input: { accountSubjectId?: string | null; deviceId?: string | null; policyConfigured: boolean; freshReview: boolean; browserCommandAvailable?: boolean }): typeof WEB_MONITORING_STATES[keyof typeof WEB_MONITORING_STATES];
export function shouldResetWebReview(previousContextKey: string, nextContextKey: string): boolean;
