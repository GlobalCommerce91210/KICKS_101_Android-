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
  async requestAuthorization() {
    if (Platform.OS !== 'android' || !native) throw new Error('Android VPN collector unavailable on this platform.');
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
