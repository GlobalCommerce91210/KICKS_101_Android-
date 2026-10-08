import { accountApi, AccountError, type Resource } from './accountApi';
export const profilePaths = {
  state: '/v1/me/consumer-state', snapshot: '/core/consumer/v1/snapshot', devices: '/core/consumer/v1/devices',
  permissions: '/v1/me/permissions', consent: '/v1/me/consent', monitoring: '/v1/me/monitoring', wallet: '/v1/me/wallet'
};
export type ProfileKey = keyof typeof profilePaths;
export type ProfileData = Partial<Record<ProfileKey, { data?: Resource; error?: string }>>;
export async function hydrateProfile(consumerId: string): Promise<ProfileData> {
  const entries = await Promise.all(Object.entries(profilePaths).map(async ([key, path]) => {
    try {
      const data = await accountApi.resource(path);
      if (data.consumer_id !== consumerId) throw new AccountError(503, 'consumer_identity_mismatch');
      return [key, { data }] as const;
    } catch (e) {
      if (e instanceof AccountError && e.status === 401) throw e;
      return [key, { error: 'Currently unavailable. Please retry.' }] as const;
    }
  }));
  return Object.fromEntries(entries);
}
