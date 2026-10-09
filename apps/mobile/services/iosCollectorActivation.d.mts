export class CollectorActivationError extends Error {}
export interface CollectorPolicy { permissionId: string; policyVersion: string; purposeVersion: string; purpose: string; }
export interface BoundCollectorConsent extends CollectorPolicy { action: string; deviceId: string; subjectId: string; }
export interface IosCollectorNative {
  getDeviceId(): Promise<string>;
  prepare(): Promise<void>;
  requestAuthorization(): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<{deviceId: string; permissionId: string; connected: boolean; consentVerified: boolean; collecting: boolean; lastAcceptedObservationAt?: string}>;
}
export function activateIosCollector(deps: {
  subject(): string | null;
  disclose(): Promise<boolean>;
  native?: IosCollectorNative;
  policy: CollectorPolicy;
  readConsent(deviceId: string): Promise<BoundCollectorConsent | null>;
  grantConsent(deviceId: string): Promise<void>;
  onState(state: string): void;
}): Promise<{state: string; reason?: string}>;
