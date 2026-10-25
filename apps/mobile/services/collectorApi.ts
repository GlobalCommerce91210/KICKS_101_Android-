import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export type CollectorState =
  | 'UNAVAILABLE'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED';

export interface CollectorStatus {
  state: CollectorState;
  vpnAuthorized: boolean;
  notificationPermissionGranted: boolean;
  collectorEnabled: boolean;
  monitoringDefaultOn: false;
  verification: 'not_verified' | 'verified';
}

type NativeCollectorModule = {
  getStatus(): Promise<CollectorStatus>;
  verifyBackendEligibility(apiBaseUrl: string, deviceToken: string, permissionId: string, purpose: string, activationRequested: boolean): Promise<{ eligible: boolean; backendEligible?: boolean; reason: string }>;
  requestAuthorization(): Promise<'authorized' | 'authorization_opened'>;
  start(): Promise<'starting'>;
  stop(): Promise<'stopping'>;
};

const native = NativeModules.KicksVpn as NativeCollectorModule | undefined;

const unavailable: CollectorStatus = {
  state: 'UNAVAILABLE',
  vpnAuthorized: false,
  notificationPermissionGranted: false,
  collectorEnabled: false,
  monitoringDefaultOn: false,
  verification: 'not_verified'
};

/** Reports native readiness only; it never implies that traffic is being collected. */
export const collectorApi = {
  async getStatus(): Promise<CollectorStatus> {
    if (Platform.OS !== 'android' || !native) return unavailable;
    try {
      const status = await native.getStatus();
      const allowed: CollectorState[] = [
        'UNAVAILABLE', 'DISCONNECTED', 'CONNECTING', 'VERIFYING',
        'VERIFIED', 'VERIFICATION_FAILED'
      ];
      if (!allowed.includes(status.state) || status.monitoringDefaultOn !== false) return unavailable;
      if (status.state === 'VERIFIED' && status.verification !== 'verified') return unavailable;
      return status;
    } catch {
      return unavailable;
    }
  },
  async verifyBackendEligibility(apiBaseUrl: string, deviceToken: string, permissionId: string, purpose: string) {
    if (Platform.OS !== 'android' || !native) return { eligible: false, reason: 'collector_unavailable' };
    try {
      return await native.verifyBackendEligibility(apiBaseUrl, deviceToken, permissionId, purpose, true);
    } catch {
      return { eligible: false, reason: 'backend_verification_unavailable' };
    }
  },
  async requestAuthorization() {
    if (Platform.OS !== 'android' || !native) throw new Error('Android VPN collector unavailable on this platform.');
    const status = await this.getStatus();
    if (!status.collectorEnabled || status.state === 'UNAVAILABLE') {
      throw new Error('The Android collector is unavailable in this build. No permissions were requested and monitoring remains off.');
    }
    if (Number(Platform.Version) >= 33) {
      const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      const result = await PermissionsAndroid.request(permission, {
        title: "KICK'S monitoring notification",
        message: 'If monitoring is explicitly enabled in a future verified build, Android must show a persistent notification and visible stop control.',
        buttonPositive: 'Continue',
        buttonNegative: 'Not now'
      });
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Notification permission was not granted. Monitoring remains OFF.');
      }
    }
    return native.requestAuthorization();
  },
  async start() {
    if (Platform.OS !== 'android' || !native) throw new Error('Android VPN collector unavailable on this platform.');
    return native.start();
  },
  async stop() {
    if (Platform.OS !== 'android' || !native) return 'stopping' as const;
    return native.stop();
  }
};
