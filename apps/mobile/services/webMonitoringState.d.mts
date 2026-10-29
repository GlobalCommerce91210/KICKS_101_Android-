export declare const WEB_MONITORING_STATES: Readonly<{
  sign_in_required: 'sign_in_required';
  policy_unavailable: 'policy_unavailable';
  not_connected: 'not_connected';
  fresh_review_required: 'fresh_review_required';
  browser_control_unavailable: 'browser_control_unavailable';
}>;
export interface WebMonitoringPolicyIdentity { permissionId?: string; policyVersion?: string; purposeVersion?: string; purpose?: string; }
export interface WebMonitoringRequestContext { sessionGeneration?: number | null; accountSubjectId?: string | null; deviceId?: string | null; policy?: WebMonitoringPolicyIdentity | null; }
export interface WebMonitoringRequestSnapshot { nonce: number; contextKey: string; }
export interface WebMonitoringRequestGuard { begin(context: WebMonitoringRequestContext): WebMonitoringRequestSnapshot; snapshot(context: WebMonitoringRequestContext, nonce: number): WebMonitoringRequestSnapshot; invalidate(): void; cleanup(): void; isCurrent(request: WebMonitoringRequestSnapshot, context: WebMonitoringRequestContext): boolean; }
export function webMonitoringContextKey(input: WebMonitoringRequestContext): string;
export function createWebRequestGuard(): WebMonitoringRequestGuard;
export function supersedeWebRequest(input: { guard: WebMonitoringRequestGuard; busyRef: { current: boolean }; setBusy: (busy: boolean) => void }): void;
export function webMonitoringState(input: { accountSubjectId?: string | null; deviceId?: string | null; policyConfigured: boolean; freshReview: boolean; browserCommandAvailable?: boolean }): typeof WEB_MONITORING_STATES[keyof typeof WEB_MONITORING_STATES];
export function shouldResetWebReview(previousContextKey: string, nextContextKey: string): boolean;
