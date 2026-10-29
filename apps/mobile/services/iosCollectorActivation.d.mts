export class CollectorActivationError extends Error {}
export interface CollectorPolicy { permissionId: string; policyVersion: string; purposeVersion: string; purpose: string; }
export interface BoundCollectorConsent extends CollectorPolicy { action: string; deviceId: string; subjectId: string; activationId: string; }
export interface IosCollectorNative {
  provision?(apiOrigin: string, accountBearer: string, accountSubjectId: string): Promise<string>;
  renewLease?(accountBearer: string, permissionId: string): Promise<void>;
  getDeviceId(): Promise<string>;
  prepare(): Promise<void>;
  requestAuthorization(): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<{deviceId?: string; permissionId?: string; activationId?: string; expiresAt?: string; connectionState?: string; connected?: boolean; consentVerified?: boolean; collecting?: boolean; lastAcceptedObservationAt?: string; unavailableReason?: string}>;
}
export function isCanonicalUuid(value: unknown): value is string;
export function isCompleteCollectorStatus(status: Awaited<ReturnType<IosCollectorNative['getStatus']>> | null | undefined): boolean;
export function verifiedCollectorStopped(status: Awaited<ReturnType<IosCollectorNative['getStatus']>> | null | undefined): boolean;
export function collectorControlAction(state: string, startInFlight?: boolean): 'start' | 'stop';
export function stopCollectorAndVerify(native: IosCollectorNative | undefined): Promise<Awaited<ReturnType<IosCollectorNative['getStatus']>>;
export function verifiedCollectorConnection(status: Awaited<ReturnType<IosCollectorNative['getStatus']>>, consent: BoundCollectorConsent | null, now?: number): boolean;
export function activateIosCollector(deps: {
  subject(): string | null;
  isCanceled?(): boolean;
  disclose(): Promise<boolean>;
  provision?(): Promise<void>;
  renewLease?(): Promise<void>;
  native?: IosCollectorNative;
  policy: CollectorPolicy;
  readConsent(deviceId: string): Promise<BoundCollectorConsent | null>;
  newActivationRequestId?(): string;
  grantConsent(deviceId: string, activationRequestId: string): Promise<void>;
  onState(state: string): void;
  wait?(milliseconds: number): Promise<void>;
}): Promise<{state: string; reason?: string}>;
