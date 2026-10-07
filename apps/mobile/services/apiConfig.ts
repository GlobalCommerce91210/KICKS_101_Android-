import { Platform } from 'react-native';
import { resolveApiBaseUrl } from './apiEndpoint';

export function getBaseUrl(): string {
  return resolveApiBaseUrl(
    Platform.OS,
    process.env.EXPO_PUBLIC_API_URL,
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined
  );
}
