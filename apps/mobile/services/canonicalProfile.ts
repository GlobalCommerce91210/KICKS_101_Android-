export type JsonRecord = Record<string, unknown>;
export type ProfileSection = { data?: JsonRecord; error?: string };
export type CanonicalProfile = { profile: ProfileSection; snapshot: ProfileSection; devices: ProfileSection };
export interface AccountRequester { request(path: string): Promise<Response>; }
function record(value: unknown): value is JsonRecord { return !!value && typeof value === 'object' && !Array.isArray(value); }
export async function loadCanonicalProfile(requester: AccountRequester, subjectId: string): Promise<CanonicalProfile> {
  const paths = { profile: '/core/consumer/v1/profile', snapshot: '/core/consumer/v1/snapshot', devices: '/core/consumer/v1/devices' };
  const sections = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    try {
      const response = await requester.request(path);
      if (!response.ok) throw new Error();
      const data: unknown = await response.json();
      if (!record(data)) throw new Error();
      if (key === 'profile' && (!record(data.account) || data.account.subject_id !== subjectId || !record(data.entitlement) || data.entitlement.subject_id !== subjectId || !record(data.profile) || data.profile.subject_id !== subjectId)) throw new Error();
      if (key === 'snapshot' && (!record(data.consumer) || data.consumer.subject_id !== subjectId)) throw new Error();
      if (key === 'devices' && (!Array.isArray(data.devices) || data.devices.some(device => !record(device) || device.subject_id !== subjectId || typeof device.device_id !== 'string'))) throw new Error();
      return [key, { data }] as const;
    } catch { return [key, { error: 'Currently unavailable. Please retry.' }] as const; }
  }));
  return Object.fromEntries(sections) as CanonicalProfile;
}
