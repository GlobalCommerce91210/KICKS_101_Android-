import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 'kicks.device-session.v1';

export interface DeviceCredentials {
  deviceId: string;
  subjectId: string;
  deviceToken: string;
}

export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: Parameters<typeof SecureStore.setItemAsync>[2]
  ): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface DeviceCredentialStorage {
  read(): Promise<DeviceCredentials | null>;
  write(credentials: DeviceCredentials): Promise<void>;
  clear(): Promise<void>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidDeviceCredentials(value: unknown): value is DeviceCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DeviceCredentials>;
  return typeof candidate.deviceId === 'string' && uuidPattern.test(candidate.deviceId) &&
    typeof candidate.subjectId === 'string' && uuidPattern.test(candidate.subjectId) &&
    typeof candidate.deviceToken === 'string' && candidate.deviceToken.length >= 16 &&
    candidate.deviceToken.length <= 8192 && !/[\s\u0000-\u001f\u007f]/.test(candidate.deviceToken);
}

export function createDeviceCredentialStorage(
  secureStore: SecureStoreAdapter,
  platform: string
): DeviceCredentialStorage {
  return {
    async read() {
      const stored = await secureStore.getItemAsync(STORAGE_KEY);
      if (stored === null) return null;
      try {
        const credentials: unknown = JSON.parse(stored);
        if (isValidDeviceCredentials(credentials)) return credentials;
      } catch {
        // Malformed credential data is not recoverable and must not be used.
      }
      await secureStore.deleteItemAsync(STORAGE_KEY);
      return null;
    },
    async write(credentials) {
      if (!isValidDeviceCredentials(credentials)) {
        throw new Error('Refusing to persist invalid device credentials.');
      }
      const options = platform === 'ios'
        ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
        : undefined;
      await secureStore.setItemAsync(STORAGE_KEY, JSON.stringify(credentials), options);
    },
    async clear() {
      await secureStore.deleteItemAsync(STORAGE_KEY);
    }
  };
}

export const deviceCredentialStorage = createDeviceCredentialStorage(SecureStore, Platform.OS);
