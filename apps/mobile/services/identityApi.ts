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
