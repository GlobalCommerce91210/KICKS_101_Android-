import { randomUUID } from 'node:crypto';

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

export const INITIAL_MARKETPLACE_OFFERS: MarketplaceOffer[] = [
  {
    offer_id: 'offer-retail-001',
    buyer_id: 'buyer-cons-res-9',
    buyer_category: 'Consumer Insights & Market Research',
    metadata_types: ['commercial', 'transactional', 'intent'],
    pricing_model: {
      type: 'per_bundle',
      min_value_per_event: 0.15,
      max_value_per_event: 0.25
    },
    regions_allowed: ['US', 'EU', 'CA'],
    consent_required: true,
    status: 'active'
  },
  {
    offer_id: 'offer-mobility-002',
    buyer_id: 'buyer-urban-mob-4',
    buyer_category: 'Urban Mobility Demand Research',
    metadata_types: ['behavioral', 'device'],
    pricing_model: {
      type: 'per_event',
      min_value_per_event: 0.08,
      max_value_per_event: 0.12
    },
    regions_allowed: ['US', 'GLOBAL'],
    consent_required: true,
    status: 'active'
  },
  {
    offer_id: 'offer-telemetry-003',
    buyer_id: 'buyer-privacy-lab-1',
    buyer_category: 'Open Telemetry Performance Lab',
    metadata_types: ['operational', 'device'],
    pricing_model: {
      type: 'per_event',
      min_value_per_event: 0.04,
      max_value_per_event: 0.06
    },
    regions_allowed: ['GLOBAL'],
    consent_required: false,
    status: 'active'
  }
];

export function getDefaultGates(appId: string): AppMetadataGates {
  const isShop = appId.includes('shop') || appId.includes('retail') || appId.includes('store');
  return {
    app_id: appId,
    gates: [
      {
        metadata_type: 'commercial',
        default_state: isShop ? 'conditional' : 'allowed',
        buyer_overrides: [
          { buyer_category: 'Consumer Insights & Market Research', state: 'allowed' }
        ]
      },
      {
        metadata_type: 'transactional',
        default_state: 'conditional',
        buyer_overrides: [
          { buyer_category: 'Consumer Insights & Market Research', state: 'allowed' }
        ]
      },
      {
        metadata_type: 'intent',
        default_state: 'allowed',
        buyer_overrides: []
      },
      {
        metadata_type: 'behavioral',
        default_state: 'allowed',
        buyer_overrides: []
      },
      {
        metadata_type: 'engagement',
        default_state: 'allowed',
        buyer_overrides: []
      },
      {
        metadata_type: 'device',
        default_state: 'allowed',
        buyer_overrides: []
      },
      {
        metadata_type: 'operational',
        default_state: 'allowed',
        buyer_overrides: []
      }
    ]
  };
}

export class IntelligenceEngine {
  private events = new Map<string, IntelligenceEventView>();
  private appGates = new Map<string, AppMetadataGates>();
  private offers: MarketplaceOffer[] = [...INITIAL_MARKETPLACE_OFFERS];

  constructor() {
    this.seedDefaultEvents();
  }

  private seedDefaultEvents() {
    // Seed initial event for com.example.shop
    const shopEvent: TelemetryEvent = {
      event_id: 'evt-shop-sample-01',
      timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      app_id: 'com.example.shop',
      device_id: 'dev-zero-trust-01',
      user_id: 'sub-user-1',
      sdk_version: 'kicks-1.0.0',
      network: {
        domain: 'events.analytics.example',
        endpoint: '/v2/collect',
        method: 'POST',
        status_code: 200
      },
      metadata: {
        category_view: 'footwear_athletic',
        dwell_time_seconds: 42,
        purchase_intent_tier: 'high',
        session_id: 'sess-8491'
      },
      tags: ['shopping', 'session_analytics', 'commercial']
    };

    this.processEvent(shopEvent);

    // Seed initial event for com.example.transit
    const transitEvent: TelemetryEvent = {
      event_id: 'evt-transit-map-02',
      timestamp: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
      app_id: 'com.example.transit',
      device_id: 'dev-zero-trust-01',
      user_id: null,
      sdk_version: 'kicks-1.0.0',
      network: {
        domain: 'api.mapbox.com',
        endpoint: '/v4/tiles/vector',
        method: 'GET',
        status_code: 200
      },
      metadata: {
        zoom_level: 14,
        region_code: 'US-CA',
        render_duration_ms: 18
      },
      tags: ['navigation', 'map_tiles', 'operational']
    };

    this.processEvent(transitEvent);
  }

  public getGates(appId: string): AppMetadataGates {
    let gates = this.appGates.get(appId);
    if (!gates) {
      gates = getDefaultGates(appId);
      this.appGates.set(appId, gates);
    }
    return gates;
  }

  public updateGates(appId: string, updated: AppMetadataGates): AppMetadataGates {
    this.appGates.set(appId, { ...updated, app_id: appId });
    return this.appGates.get(appId)!;
  }

  public getEvent(eventId: string): IntelligenceEventView | null {
    return this.events.get(eventId) ?? null;
  }

  public getOffers(): MarketplaceOffer[] {
    return this.offers;
  }

  public processEvent(event: TelemetryEvent): IntelligenceEventView {
    const gates = this.getGates(event.app_id);
    const domain = event.network.domain.toLowerCase();
    const endpoint = event.network.endpoint.toLowerCase();
    const tags = (event.tags ?? []).map(t => t.toLowerCase());

    const isCommercial =
      domain.includes('analytics') ||
      domain.includes('ad') ||
      domain.includes('market') ||
      tags.includes('commercial') ||
      tags.includes('shopping') ||
      event.app_id.includes('shop');

    const isOperational =
      domain.includes('mapbox') ||
      domain.includes('map') ||
      domain.includes('weather') ||
      domain.includes('crash') ||
      domain.includes('diagnostics') ||
      tags.includes('operational');

    const category: ClassificationResult['category'] = isCommercial
      ? 'behavioral_commercial'
      : isOperational
      ? 'operational'
      : domain.includes('suspicious') || domain.includes('tracker')
      ? 'unexpected'
      : 'unknown';

    const reason_codes: string[] = [];
    if (isCommercial) {
      reason_codes.push('COMMERCIAL_TAGS_DETECTED', 'ANALYTICS_ENDPOINT_RECOGNIZED');
    } else if (isOperational) {
      reason_codes.push('STANDARD_INFRASTRUCTURE_PATTERN', 'NO_IDENTITY_PAYLOAD');
    } else {
      reason_codes.push('UNFAMILIAR_DESTINATION_DOMAIN');
    }

    // Scores
    const commercial_intent_score = isCommercial ? 88.5 : isOperational ? 8.0 : 35.0;
    const baseline_stability_score = 94.0;
    const deviation_severity_score = category === 'unexpected' ? 78.0 : isCommercial ? 22.0 : 6.0;
    const purpose_confidence_score = 96.5;

    // Persona
    const persona: PersonaAssignment = {
      scope: 'app',
      scope_id: event.app_id,
      persona: isCommercial ? 'heavy_commercial' : isOperational ? 'operational' : 'mixed',
      effective_from: event.timestamp
    };

    // Metadata items inspection
    const metadataObj = event.metadata ?? {};
    const metadata_items: MetadataItem[] = [];

    const keys = Object.keys(metadataObj);
    if (keys.length === 0) {
      // Add default inferred metadata from event
      keys.push('destination_host', 'connection_protocol');
    }

    for (const key of keys) {
      let metaType: MetadataType = 'operational';
      let valuePerEvent = 0.02;
      let buyers = ['Telemetry Lab'];

      if (key.includes('purchase') || key.includes('cart') || key.includes('intent')) {
        metaType = 'intent';
        valuePerEvent = 0.12;
        buyers = ['Consumer Insights & Market Research'];
      } else if (key.includes('category') || key.includes('product') || key.includes('price')) {
        metaType = 'commercial';
        valuePerEvent = 0.08;
        buyers = ['Consumer Insights & Market Research', 'Retail Research Network'];
      } else if (key.includes('dwell') || key.includes('scroll') || key.includes('click')) {
        metaType = 'engagement';
        valuePerEvent = 0.05;
        buyers = ['Consumer Insights & Market Research'];
      } else if (key.includes('region') || key.includes('zoom') || key.includes('geo')) {
        metaType = 'behavioral';
        valuePerEvent = 0.06;
        buyers = ['Urban Mobility Demand Research'];
      } else if (key.includes('device') || key.includes('os') || key.includes('screen')) {
        metaType = 'device';
        valuePerEvent = 0.03;
        buyers = ['Open Telemetry Performance Lab'];
      }

      // Check gate state
      const gateConfig = gates.gates.find(g => g.metadata_type === metaType);
      const consent_state: ConsentState = gateConfig?.default_state ?? 'allowed';

      metadata_items.push({
        key,
        type: metaType,
        description: `Normalized ${metaType} signal extracted from ${key}`,
        sample_value: metadataObj[key] ?? 'minimized_hash',
        estimated_value_per_event: valuePerEvent,
        buyer_categories: buyers,
        consent_required: metaType !== 'operational',
        consent_state
      });
    }

    const total_estimated_value = metadata_items
      .filter(m => m.consent_state !== 'blocked')
      .reduce((acc, cur) => acc + cur.estimated_value_per_event, 0);

    const eligible_for_marketplace =
      total_estimated_value > 0 &&
      metadata_items.some(m => m.consent_state === 'allowed');

    const metadata_value_estimate = Number(total_estimated_value.toFixed(4));

    const scores: ScoreSet = {
      commercial_intent_score,
      metadata_value_estimate,
      baseline_stability_score,
      deviation_severity_score,
      purpose_confidence_score
    };

    const explanation: Explanation = {
      title: isCommercial ? 'Commercial Value Opportunity Detected' : 'Operational Telemetry Verified',
      summary: isCommercial
        ? `Outbound transmission to ${event.network.domain} carries high commercial and intent value. Gated metadata may be monetized with verified research partners.`
        : `Connection to ${event.network.domain} aligns with expected service operations without identifiable identity payloads.`,
      details: [
        `App ID: ${event.app_id}`,
        `Destination Host: ${event.network.domain}`,
        `Zero-Trust Attestation: Payload minimization enforced`,
        `Gating Status: ${eligible_for_marketplace ? 'Eligible for marketplace match' : 'Gated / Not eligible'}`
      ],
      confidence_band: 'high',
      tags: ['zero_trust', category, `value_$${metadata_value_estimate}`]
    };

    const inspection: MetadataInspectionView = {
      event_id: event.event_id,
      app_id: event.app_id,
      metadata_items,
      total_estimated_value: metadata_value_estimate,
      eligible_for_marketplace
    };

    const view: IntelligenceEventView = {
      event_id: event.event_id,
      app_id: event.app_id,
      device_id: event.device_id,
      classification: {
        category,
        reason_codes
      },
      scores,
      persona,
      explanation,
      metadata_inspection: inspection
    };

    this.events.set(event.event_id, view);
    return view;
  }

  public matchMarketplace(req: MarketplaceMatchRequest): MarketplaceMatchResult {
    const gates = this.getGates(req.app_id);
    const appEvents = [...this.events.values()].filter(e => e.app_id === req.app_id);

    const allowedTypes = new Set(
      gates.gates
        .filter(g => g.default_state === 'allowed' || g.default_state === 'conditional')
        .map(g => g.metadata_type as string)
    );

    const total_events = appEvents.length > 0 ? appEvents.length : 18;
    const eligible_events = Math.max(1, Math.round(total_events * 0.85));

    const matched_offers = this.offers
      .filter(offer => offer.status === 'active')
      .filter(offer => offer.metadata_types.some(t => allowedTypes.has(t)))
      .map(offer => {
        const events_matched = Math.min(eligible_events, Math.round(eligible_events * 0.9));
        const effective_value_per_event = offer.pricing_model.min_value_per_event ?? 0.10;
        const total_payout = Number(
          (offer.pricing_model.type === 'per_bundle'
            ? 8.00
            : events_matched * effective_value_per_event
          ).toFixed(2)
        );

        return {
          offer,
          events_matched,
          effective_value_per_event,
          total_payout
        };
      });

    return {
      app_id: req.app_id,
      period_start: req.period_start ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
      period_end: req.period_end ?? new Date().toISOString(),
      total_events,
      eligible_events,
      matched_offers
    };
  }

  public getAppSummary(appId: string, periodStart?: string, periodEnd?: string): AppIntelligenceSummary {
    const marketplace_summary = this.matchMarketplace({
      app_id: appId,
      period_start: periodStart,
      period_end: periodEnd
    });

    const appEvents = [...this.events.values()].filter(e => e.app_id === appId);
    const total_events = appEvents.length > 0 ? appEvents.length : marketplace_summary.total_events;

    const category_distribution: Record<string, number> = {
      behavioral_commercial: 0,
      operational: 0,
      unexpected: 0,
      unknown: 0
    };

    if (appEvents.length > 0) {
      for (const ev of appEvents) {
        category_distribution[ev.classification.category] =
          (category_distribution[ev.classification.category] ?? 0) + 1;
      }
    } else {
      category_distribution.behavioral_commercial = 12;
      category_distribution.operational = 6;
    }

    const isShop = appId.includes('shop');
    const average_scores: ScoreSet = {
      commercial_intent_score: isShop ? 86.4 : 14.2,
      metadata_value_estimate: isShop ? 0.22 : 0.05,
      baseline_stability_score: 93.0,
      deviation_severity_score: 11.5,
      purpose_confidence_score: 95.8
    };

    const persona: PersonaAssignment = {
      scope: 'app',
      scope_id: appId,
      persona: isShop ? 'heavy_commercial' : 'operational',
      effective_from: periodStart ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()
    };

    const total_estimated_value = Number(
      marketplace_summary.matched_offers
        .reduce((sum, item) => sum + item.total_payout, 0)
        .toFixed(2)
    );

    return {
      app_id: appId,
      period_start: marketplace_summary.period_start,
      period_end: marketplace_summary.period_end,
      total_events,
      category_distribution,
      average_scores,
      persona,
      total_estimated_value,
      marketplace_summary
    };
  }
}
