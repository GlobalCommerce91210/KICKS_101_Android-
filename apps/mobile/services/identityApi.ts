import { NativeModules } from 'react-native';

/**
 * Provider-agnostic glue between an OIDC sign-in (AppAuth or the vendor SDK, not yet selected) and the
 * native collector. The sign-in step itself is the remaining external blocker; this file only handles
 * what happens with its result.
 */
export interface SignedInSession { accountId: string; accessToken: string; expiresAtMs: number }

const native = () => NativeModules.KicksVpn;

/** Enrolls this install as owned by the signed-in account, then stores the session in Keystore-backed storage. */
export async function enrollDevice(apiBase: string, deviceId: string, session: SignedInSession): Promise<'enrolled' | 'device_owned_by_another_account'> {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/v1/devices/enroll`, {
    method: 'POST',
    headers: { authorization: ['Bearer', session.accessToken].join(' '), 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId })
  });
  if (res.status === 403) return 'device_owned_by_another_account';
  if (!res.ok) throw new Error(`Enrollment failed (${res.status}).`);
  // Native setSession also rejects a locally cross-bound account (DEVICE_OWNED_BY_OTHER_ACCOUNT).
  await native().setSession(session.accountId, deviceId, session.accessToken, session.expiresAtMs);
  return 'enrolled';
}

/** Logout, remote revocation or expiry: removes credentials and stops + purges the collector. */
export const endSession = () => native().clearSession();

/** Auth0 tenant settings; values come from the build environment, never from source. */
export const AUTH0 = {
  domain: process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? '',
  clientId: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? '',
  audience: process.env.EXPO_PUBLIC_AUTH0_AUDIENCE ?? '',
  redirectUri: 'kicks://auth/callback',
};

export type RefreshOutcome = { status: 'refreshed'; session: SignedInSession; refreshToken?: string } | { status: 'revoked' } | { status: 'unavailable' };

/**
 * Exchanges a refresh token at the Auth0 token endpoint. A definitive rejection (invalid_grant: the
 * token was revoked, rotated or expired) ends the session so the collector stops and its queue is
 * purged; a network/server failure leaves the session untouched and is retried by the caller.
 */
export async function refreshSession(accountId: string, refreshToken: string): Promise<RefreshOutcome> {
  if (!AUTH0.domain || !AUTH0.clientId) return { status: 'unavailable' };
  try {
    const res = await fetch(`https://${AUTH0.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: AUTH0.clientId, refresh_token: refreshToken }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) { await endSession(); return { status: 'revoked' }; }
    if (!res.ok) return { status: 'unavailable' };
    const body = await res.json();
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') return { status: 'unavailable' };
    return {
      status: 'refreshed',
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      session: { accountId, accessToken: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 },
    };
  } catch { return { status: 'unavailable' }; }
}
