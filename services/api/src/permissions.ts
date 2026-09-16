import { randomUUID } from 'node:crypto';
import { IntelligenceEngine, MetadataType } from './intelligence.js';

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
  metadata_type: MetadataType;
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

export class PermissionsEngine {
  private userApps = new Map<string, AppPermission[]>();
  private userMetadata = new Map<string, Map<string, MetadataPermission[]>>();
  private userBuyers = new Map<string, BuyerPermission[]>();
  private consentLogs = new Map<string, ConsentLogEntry[]>();
  private intelligenceEngine?: IntelligenceEngine;

  constructor(intelligenceEngine?: IntelligenceEngine) {
    this.intelligenceEngine = intelligenceEngine;
    this.seedDefaultUser('user_demo_01');
  }

  private seedDefaultUser(userId: string) {
    const now = new Date();
    const updated = now.toISOString();

    const apps: AppPermission[] = [
      {
        app_id: 'com.example.shop',
        app_name: 'Shop Sample',
        state: 'allowed',
        reason: 'User approved commercial research participation',
        last_updated: updated
      },
      {
        app_id: 'com.example.transit',
        app_name: 'Transit Map',
        state: 'limited',
        reason: 'Restricted to coarse regional dwell points only',
        last_updated: updated
      },
      {
        app_id: 'com.retail.trends',
        app_name: 'Retail Trends',
        state: 'allowed',
        reason: 'Verified retailer partner aggregation',
        last_updated: updated
      }
    ];
    this.userApps.set(userId, apps);

    const metaMap = new Map<string, MetadataPermission[]>();

    const defaultMeta: MetadataPermission[] = [
      {
        metadata_type: 'commercial',
        key: 'category_totals',
        state: 'conditional',
        buyer_overrides: [
          { buyer_category: 'Consumer Insights & Market Research', state: 'allowed' }
        ],
        last_updated: updated
      },
      {
        metadata_type: 'transactional',
        key: 'basket_tiers',
        state: 'conditional',
        buyer_overrides: [
          { buyer_category: 'Consumer Insights & Market Research', state: 'allowed' }
        ],
        last_updated: updated
      },
      {
        metadata_type: 'intent',
        key: 'search_intent',
        state: 'allowed',
        buyer_overrides: [],
        last_updated: updated
      },
      {
        metadata_type: 'behavioral',
        key: 'regional_viewport',
        state: 'allowed',
        buyer_overrides: [],
        last_updated: updated
      },
      {
        metadata_type: 'engagement',
        key: 'session_duration',
        state: 'allowed',
        buyer_overrides: [],
        last_updated: updated
      },
      {
        metadata_type: 'device',
        key: 'os_family',
        state: 'allowed',
        buyer_overrides: [],
        last_updated: updated
      },
      {
        metadata_type: 'operational',
        key: 'diagnostics',
        state: 'allowed',
        buyer_overrides: [],
        last_updated: updated
      }
    ];

    metaMap.set('com.example.shop', defaultMeta);
    metaMap.set('com.example.transit', [
      ...defaultMeta.map(m => m.metadata_type === 'commercial' ? { ...m, state: 'blocked' as MetadataState } : m)
    ]);
    metaMap.set('com.retail.trends', defaultMeta);
    this.userMetadata.set(userId, metaMap);

    const buyers: BuyerPermission[] = [
      {
        buyer_category: 'Consumer Insights & Market Research',
        state: 'allowed',
        max_value_band: 10.0,
        last_updated: updated
      },
      {
        buyer_category: 'Urban Mobility Demand Research',
        state: 'allowed',
        max_value_band: 5.0,
        last_updated: updated
      },
      {
        buyer_category: 'Open Telemetry Performance Lab',
        state: 'allowed',
        max_value_band: 2.0,
        last_updated: updated
      },
      {
        buyer_category: 'AdTech & Behavioral Retargeting',
        state: 'blocked',
        max_value_band: 0,
        last_updated: updated
      }
    ];
    this.userBuyers.set(userId, buyers);

    const logs: ConsentLogEntry[] = [
      {
        log_id: `clog-${randomUUID().slice(0, 8)}`,
        user_id: userId,
        app_id: 'com.example.shop',
        metadata_type: 'commercial',
        key: 'category_totals',
        buyer_category: 'Consumer Insights & Market Research',
        previous_state: 'conditional',
        new_state: 'allowed',
        context: 'marketplace_agreement',
        timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 3).toISOString()
      },
      {
        log_id: `clog-${randomUUID().slice(0, 8)}`,
        user_id: userId,
        app_id: null,
        metadata_type: null,
        key: null,
        buyer_category: 'AdTech & Behavioral Retargeting',
        previous_state: 'allowed',
        new_state: 'blocked',
        context: 'privacy_zero_trust_policy',
        timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString()
      },
      {
        log_id: `clog-${randomUUID().slice(0, 8)}`,
        user_id: userId,
        app_id: 'com.example.transit',
        metadata_type: 'behavioral',
        key: 'gps_precise',
        buyer_category: null,
        previous_state: 'allowed',
        new_state: 'limited',
        context: 'minimization_inspector',
        timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 48).toISOString()
      }
    ];
    this.consentLogs.set(userId, logs);
  }

  public getAppPermissions(userId: string): AppPermission[] {
    if (!this.userApps.has(userId)) {
      this.seedDefaultUser(userId);
    }
    return this.userApps.get(userId) ?? [];
  }

  public setAppPermissions(userId: string, apps: AppPermission[], context = 'permissions_dashboard'): AppPermission[] {
    const existing = this.getAppPermissions(userId);
    const existingMap = new Map(existing.map(a => [a.app_id, a]));
    const now = new Date().toISOString();

    for (const app of apps) {
      const prev = existingMap.get(app.app_id);
      if (prev && prev.state !== app.state) {
        this.appendLog({
          log_id: `clog-${randomUUID().slice(0, 8)}`,
          user_id: userId,
          app_id: app.app_id,
          previous_state: prev.state,
          new_state: app.state,
          context,
          timestamp: now
        });
      }
      app.last_updated = now;
      existingMap.set(app.app_id, app);
    }

    const updatedList = Array.from(existingMap.values());
    this.userApps.set(userId, updatedList);
    return updatedList;
  }

  public getMetadataPermissions(userId: string, appId: string): MetadataPermission[] {
    this.getAppPermissions(userId);
    let appMap = this.userMetadata.get(userId);
    if (!appMap) {
      appMap = new Map();
      this.userMetadata.set(userId, appMap);
    }
    let perms = appMap.get(appId);
    if (!perms) {
      const now = new Date().toISOString();
      perms = [
        { metadata_type: 'commercial', state: 'allowed', buyer_overrides: [], last_updated: now },
        { metadata_type: 'transactional', state: 'allowed', buyer_overrides: [], last_updated: now },
        { metadata_type: 'intent', state: 'allowed', buyer_overrides: [], last_updated: now },
        { metadata_type: 'behavioral', state: 'allowed', buyer_overrides: [], last_updated: now },
        { metadata_type: 'engagement', state: 'allowed', buyer_overrides: [], last_updated: now },
        { metadata_type: 'device', state: 'allowed', buyer_overrides: [], last_updated: now },
        { metadata_type: 'operational', state: 'allowed', buyer_overrides: [], last_updated: now }
      ];
      appMap.set(appId, perms);
    }
    return perms;
  }

  public setMetadataPermissions(
    userId: string,
    appId: string,
    permissions: MetadataPermission[],
    context = 'metadata_inspector'
  ): MetadataPermission[] {
    const existing = this.getMetadataPermissions(userId, appId);
    const existingMap = new Map(existing.map(m => [m.metadata_type, m]));
    const now = new Date().toISOString();

    for (const p of permissions) {
      const prev = existingMap.get(p.metadata_type);
      if (prev && prev.state !== p.state) {
        this.appendLog({
          log_id: `clog-${randomUUID().slice(0, 8)}`,
          user_id: userId,
          app_id: appId,
          metadata_type: p.metadata_type,
          previous_state: prev.state,
          new_state: p.state,
          context,
          timestamp: now
        });
      }
      p.last_updated = now;
      existingMap.set(p.metadata_type, p);
    }

    const updated = Array.from(existingMap.values());
    this.userMetadata.get(userId)?.set(appId, updated);

    // Sync to IntelligenceEngine gates if present
    if (this.intelligenceEngine) {
      this.intelligenceEngine.updateGates(appId, {
        app_id: appId,
        gates: updated.map(u => ({
          metadata_type: u.metadata_type,
          default_state: u.state,
          buyer_overrides: u.buyer_overrides
        }))
      });
    }

    return updated;
  }

  public getBuyerPermissions(userId: string): BuyerPermission[] {
    if (!this.userBuyers.has(userId)) {
      this.seedDefaultUser(userId);
    }
    return this.userBuyers.get(userId) ?? [];
  }

  public setBuyerPermissions(userId: string, buyers: BuyerPermission[], context = 'buyer_controls'): BuyerPermission[] {
    const existing = this.getBuyerPermissions(userId);
    const existingMap = new Map(existing.map(b => [b.buyer_category, b]));
    const now = new Date().toISOString();

    for (const b of buyers) {
      const prev = existingMap.get(b.buyer_category);
      if (prev && prev.state !== b.state) {
        this.appendLog({
          log_id: `clog-${randomUUID().slice(0, 8)}`,
          user_id: userId,
          buyer_category: b.buyer_category,
          previous_state: prev.state,
          new_state: b.state,
          context,
          timestamp: now
        });
      }
      b.last_updated = now;
      existingMap.set(b.buyer_category, b);
    }

    const updated = Array.from(existingMap.values());
    this.userBuyers.set(userId, updated);
    return updated;
  }

  public getEffectivePermissions(userId: string): EffectivePermissionsView {
    const apps = this.getAppPermissions(userId);
    const buyers = this.getBuyerPermissions(userId);
    // Combine metadata permissions from all apps
    const allMeta: MetadataPermission[] = [];
    const appMap = this.userMetadata.get(userId);
    if (appMap) {
      for (const list of appMap.values()) {
        for (const item of list) {
          if (!allMeta.some(m => m.metadata_type === item.metadata_type && m.state === item.state)) {
            allMeta.push(item);
          }
        }
      }
    }
    return {
      user_id: userId,
      apps,
      metadata_permissions: allMeta,
      buyers
    };
  }

  public getConsentLog(userId: string, page = 1, pageSize = 50): { items: ConsentLogEntry[]; page: number; page_size: number } {
    this.getAppPermissions(userId);
    const logs = this.consentLogs.get(userId) ?? [];
    const start = (page - 1) * pageSize;
    const items = logs.slice(start, start + pageSize);
    return {
      items,
      page,
      page_size: pageSize
    };
  }

  private appendLog(entry: ConsentLogEntry) {
    const list = this.consentLogs.get(entry.user_id) ?? [];
    list.unshift(entry);
    this.consentLogs.set(entry.user_id, list);
  }
}
