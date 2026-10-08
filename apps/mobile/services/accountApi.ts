import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { requireIosApiOrigin } from './iosApiOrigin';

export type ConsumerAccount = {
  account_id: string; consumer_id: string; display_name: string; email: string | null;
  account_status: 'active' | 'restricted' | 'pending' | 'closed'; profile_status: string;
};
export type Session = { account: ConsumerAccount; expires_at: string; token?: string };
export type Resource = { consumer_id: string; [key: string]: unknown };
export class AccountError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const KEY = 'datastorm.consumer.session.v1';
let token: string | null = null;
let expired: (() => void) | undefined;
export function onSessionExpired(listener: () => void) { expired = listener; return () => { if (expired === listener) expired = undefined; }; }
function origin() {
  if (Platform.OS === 'web') return '';
  const configured = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_IOS_API_URL : process.env.EXPO_PUBLIC_API_URL;
  return requireIosApiOrigin(configured);
}
export async function clearSession() {
  token = null;
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(KEY);
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let base: string;
  try { base = origin(); } catch { throw new AccountError(503, 'account_api_not_configured'); }
  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    res = await fetch(`${base}${path}`, { ...init, credentials: 'same-origin', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-datastorm-client': Platform.OS === 'web' ? 'web' : 'native',
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  } catch { throw new AccountError(503, 'account_service_unavailable'); }
  finally { clearTimeout(timeout); }
  if (!res.ok) {
    if (res.status === 401) { await clearSession().catch(() => {}); expired?.(); }
    throw new AccountError(res.status, res.status === 401 ? 'session_expired' : res.status === 429 ? 'try_again_later' : 'account_service_unavailable');
  }
  return res.status === 204 ? undefined as T : res.json();
}
export const accountApi = {
  async restore(): Promise<Session> {
    if (Platform.OS !== 'web') {
      token = await SecureStore.getItemAsync(KEY);
      if (!token) throw new AccountError(401, 'authentication_required');
    }
    return request('/core/identity/v1/account');
  },
  async authenticate(mode: 'login' | 'create', email: string, password: string): Promise<Session> {
    const session = await request<Session>(`/core/identity/v1/session/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
    if (Platform.OS !== 'web') {
      if (!session.token) throw new AccountError(503, 'invalid_account_session');
      try { await SecureStore.setItemAsync(KEY, session.token); token = session.token; }
      catch { token = session.token; try { await request('/core/identity/v1/session/logout', { method: 'POST' }); } finally { token = null; } throw new AccountError(503, 'secure_session_storage_unavailable'); }
    }
    return session;
  },
  recover(email: string) { return request('/core/identity/v1/session/recovery', { method: 'POST', body: JSON.stringify({ email }) }); },
  async logout() {
    try { await request('/core/identity/v1/session/logout', { method: 'POST' }); } finally { await clearSession(); }
  },
  resource(path: string) { return request<Resource>(path); },
  controls() { return request<{ consumer_id: string; controls: Record<string, string> }>('/core/identity/v1/controls'); }
};
