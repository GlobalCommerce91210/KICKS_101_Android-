import { Platform } from 'react-native';

export type PermissionState = 'allowed' | 'blocked' | 'limited';
export type MetadataState = 'allowed' | 'blocked' | 'conditional';

export interface AppPermission {
  app_id: string;
  app_name: string;
  state: PermissionState;
  reason?: string;
  last_updated: string;
}

export interface MetadataPermission {
  metadata_type: string;
  key?: string;
  state: MetadataState;
  buyer_overrides?: Array<{
    buyer_category: string;
    state: MetadataState;
  }>;
  last_updated: string;
}

export interface BuyerPermission {
  buyer_category: string;
  state: PermissionState;
  max_value_band?: number;
  last_updated: string;
}

export interface EffectivePermissionsView {
  user_id: string;
  apps: AppPermission[];
  metadata_permissions: MetadataPermission[];
  buyers: BuyerPermission[];
}

export interface ConsentLogEntry {
  log_id: string;
  user_id: string;
  app_id?: string | null;
  metadata_type?: string | null;
  key?: string | null;
  buyer_category?: string | null;
  previous_state?: string | null;
  new_state: string;
  context: string;
  timestamp: string;
}

function getBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export const permissionsApi = {
  async getAppPermissions(userId: string): Promise<AppPermission[]> {
    const res = await fetch(`${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/apps`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get app permissions`);
    const data = await res.json();
    return data.apps ?? [];
  },

  async setAppPermissions(userId: string, apps: AppPermission[]): Promise<AppPermission[]> {
    const res = await fetch(`${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apps })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to update app permissions`);
    const data = await res.json();
    return data.apps ?? [];
  },

  async getMetadataPermissions(userId: string, appId: string): Promise<MetadataPermission[]> {
    const res = await fetch(
      `${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/apps/${encodeURIComponent(appId)}/metadata`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get metadata permissions`);
    const data = await res.json();
    return data.metadata_permissions ?? [];
  },

  async setMetadataPermissions(
    userId: string,
    appId: string,
    metadata_permissions: MetadataPermission[]
  ): Promise<MetadataPermission[]> {
    const res = await fetch(
      `${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/apps/${encodeURIComponent(appId)}/metadata`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata_permissions })
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to update metadata permissions`);
    const data = await res.json();
    return data.metadata_permissions ?? [];
  },

  async getBuyerPermissions(userId: string): Promise<BuyerPermission[]> {
    const res = await fetch(`${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/buyers`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get buyer permissions`);
    const data = await res.json();
    return data.buyers ?? [];
  },

  async setBuyerPermissions(userId: string, buyers: BuyerPermission[]): Promise<BuyerPermission[]> {
    const res = await fetch(`${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/buyers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buyers })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to update buyer permissions`);
    const data = await res.json();
    return data.buyers ?? [];
  },

  async getEffectivePermissions(userId: string): Promise<EffectivePermissionsView> {
    const res = await fetch(`${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/effective`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get effective permissions`);
    return res.json();
  },

  async getConsentLog(userId: string, page = 1, pageSize = 50): Promise<{
    items: ConsentLogEntry[];
    page: number;
    page_size: number;
  }> {
    const res = await fetch(
      `${getBaseUrl()}/v1/permissions/users/${encodeURIComponent(userId)}/consent-log?page=${page}&page_size=${pageSize}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get consent log`);
    return res.json();
  }
};
