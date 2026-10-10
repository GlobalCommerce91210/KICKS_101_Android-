import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { requireIosApiOrigin } from './iosApiOrigin';

export async function createDataStormAccount(email: string, password: string, accepted: boolean): Promise<void> {
  const termsVersion = process.env.EXPO_PUBLIC_TERMS_VERSION;
  const privacyVersion = process.env.EXPO_PUBLIC_PRIVACY_VERSION;
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
  if (!termsVersion || !privacyVersion || !termsUrl || !privacyUrl) throw new Error('Account registration is not configured with approved legal documents.');
  if (!accepted) throw new Error('Read and accept the Terms and Privacy Policy first.');
  if (!/^https:\/\//.test(termsUrl) || !/^https:\/\//.test(privacyUrl)) throw new Error('Approved legal document links are unavailable.');
  const origin = requireIosApiOrigin(Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_IOS_API_URL ?? process.env.EXPO_PUBLIC_API_URL
    : process.env.EXPO_PUBLIC_API_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(origin + '/core/identity/v1/account', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'idempotency-key': Crypto.randomUUID() },
      body: JSON.stringify({
        email: email.trim().toLowerCase(), password, marketing_opt_in: false,
        terms_version: termsVersion, privacy_version: privacyVersion
      })
    });
    if (response.status === 201) return;
    if (response.status === 409) throw new Error('This email may already have an account. Try signing in.');
    if (response.status === 422) throw new Error('Check your account information and try again.');
    throw new Error('Account registration is unavailable (HTTP ' + response.status + '). Try again later.');
  } catch (error) {
    if (error instanceof Error && (/^This email|^Check your|^Account registration/.test(error.message))) throw error;
    throw new Error('Unable to reach DataStorm registration. Check your connection and try again.');
  } finally { clearTimeout(timer); }
}
