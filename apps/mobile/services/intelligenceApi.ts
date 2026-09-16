import { Platform } from 'react-native';

export type MetadataType =
  | 'behavioral'
  | 'commercial'
  | 'transactional'
  | 'intent'
  | 'engagement'
  | 'device'
  | 'operational';

export type ConsentState = 'allowed' | 'blocked' | 'conditional';

export interface TelemetryEvent {
  event_id: string;
  timestamp: string;
  app_id: string;
  device_id: string;
  user_id?: string | null;
  sdk_version?: string;
  network: {
    domain: string;
    endpoint: string;
    method: string;
    status_code?: number;
  };
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface ClassificationResult {
  category: 'operational' | 'behavioral_commercial' | 'unexpected' | 'unknown';
  reason_codes: string[];
}

export interface ScoreSet {
  commercial_intent_score: number;
  metadata_value_estimate: number;
  baseline_stability_score: number;
  deviation_severity_score: number;
  purpose_confidence_score: number;
}

export interface PersonaAssignment {
  scope: 'app' | 'device' | 'user';
  scope_id: string;
  persona: 'heavy_commercial' | 'light_commercial' | 'operational' | 'mixed' | 'unknown';
  effective_from: string;
}

export interface Explanation {
  title: string;
  summary: string;
  details: string[];
  confidence_band: 'high' | 'medium' | 'low';
  tags: string[];
}

export interface MetadataItem {
  key: string;
  type: MetadataType;
  description: string;
  sample_value: unknown;
  estimated_value_per_event: number;
  buyer_categories: string[];
  consent_required: boolean;
  consent_state: ConsentState;
}

export interface MetadataInspectionView {
  event_id: string;
  app_id: string;
  metadata_items: MetadataItem[];
  total_estimated_value: number;
  eligible_for_marketplace: boolean;
}

export interface AppMetadataGates {
  app_id: string;
  gates: Array<{
    metadata_type: MetadataType;
    default_state: ConsentState;
    buyer_overrides?: Array<{
      buyer_category: string;
      state: ConsentState;
    }>;
  }>;
}

export interface MarketplaceOffer {
  offer_id: string;
  buyer_id: string;
  buyer_category: string;
  metadata_types: string[];
  pricing_model: {
    type: 'per_event' | 'per_bundle';
    min_value_per_event?: number;
    max_value_per_event?: number;
  };
  regions_allowed: string[];
  consent_required: boolean;
  status: 'active' | 'paused' | 'archived';
}

export interface MarketplaceMatchRequest {
  app_id: string;
  period_start?: string;
  period_end?: string;
}

export interface MarketplaceMatchResult {
  app_id: string;
  period_start?: string;
  period_end?: string;
  total_events: number;
  eligible_events: number;
  matched_offers: Array<{
    offer: MarketplaceOffer;
    events_matched: number;
    effective_value_per_event: number;
    total_payout: number;
  }>;
}

export interface IntelligenceEventView {
  event_id: string;
  app_id: string;
  device_id: string;
  classification: ClassificationResult;
  scores: ScoreSet;
  persona: PersonaAssignment;
  explanation: Explanation;
  metadata_inspection: MetadataInspectionView;
}

export interface AppIntelligenceSummary {
  app_id: string;
  period_start?: string;
  period_end?: string;
  total_events: number;
  category_distribution: Record<string, number>;
  average_scores: ScoreSet;
  persona: PersonaAssignment;
  total_estimated_value: number;
  marketplace_summary: MarketplaceMatchResult;
}

function getBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export const api = {
  async getAppSummary(appId: string): Promise<AppIntelligenceSummary> {
    const res = await fetch(`${getBaseUrl()}/v1/intelligence/apps/${encodeURIComponent(appId)}/summary`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to fetch app summary`);
    return res.json();
  },

  async getAppGates(appId: string): Promise<AppMetadataGates> {
    const res = await fetch(`${getBaseUrl()}/v1/inspector/apps/${encodeURIComponent(appId)}/gates`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to fetch app gates`);
    return res.json();
  },

  async updateAppGates(appId: string, gates: AppMetadataGates): Promise<AppMetadataGates> {
    const res = await fetch(`${getBaseUrl()}/v1/inspector/apps/${encodeURIComponent(appId)}/gates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(gates)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to update app gates`);
    return res.json();
  },

  async matchMarketplace(req: MarketplaceMatchRequest): Promise<MarketplaceMatchResult> {
    const res = await fetch(`${getBaseUrl()}/v1/marketplace/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to match marketplace offers`);
    return res.json();
  },

  async classifyTelemetryEvent(event: TelemetryEvent): Promise<IntelligenceEventView> {
    const res = await fetch(`${getBaseUrl()}/v1/intelligence/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to classify event`);
    return res.json();
  },

  async getEventIntelligence(eventId: string): Promise<IntelligenceEventView> {
    const res = await fetch(`${getBaseUrl()}/v1/intelligence/events/${encodeURIComponent(eventId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to fetch event`);
    return res.json();
  },

  async getEventMetadata(eventId: string): Promise<MetadataInspectionView> {
    const res = await fetch(`${getBaseUrl()}/v1/inspector/events/${encodeURIComponent(eventId)}/metadata`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to fetch metadata`);
    return res.json();
  }
};
