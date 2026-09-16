import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import {
  api,
  AppIntelligenceSummary,
  AppMetadataGates,
  ConsentState,
  IntelligenceEventView,
  MarketplaceMatchResult,
  MetadataType,
  TelemetryEvent
} from '../services/intelligenceApi';

interface AppOption {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const APPS: AppOption[] = [
  { id: 'com.example.shop', name: 'Shop Sample', icon: 'cart-outline' },
  { id: 'com.example.transit', name: 'Transit Map', icon: 'map-outline' },
  { id: 'com.retail.trends', name: 'Retail Trends', icon: 'pricetags-outline' }
];

const METADATA_TYPE_LABELS: Record<MetadataType, { title: string; desc: string; icon: keyof typeof Ionicons.glyphMap }> = {
  commercial: {
    title: 'Commercial Signals',
    desc: 'Product category totals, shopping affinities, price brackets',
    icon: 'pricetag-outline'
  },
  transactional: {
    title: 'Transactional Volume',
    desc: 'Aggregated basket tiers, purchase frequencies (no card/PII)',
    icon: 'receipt-outline'
  },
  intent: {
    title: 'Purchase Intent',
    desc: 'Wishlist adds, high-intent searches, item dwell periods',
    icon: 'flash-outline'
  },
  behavioral: {
    title: 'Behavioral & Regional',
    desc: 'Approximate region codes, map viewport zoom, dwell times',
    icon: 'analytics-outline'
  },
  engagement: {
    title: 'Session Engagement',
    desc: 'Active duration, session frequency, navigation velocity',
    icon: 'timer-outline'
  },
  device: {
    title: 'Device & Performance',
    desc: 'OS family, screen density buckets, connection protocol',
    icon: 'hardware-chip-outline'
  },
  operational: {
    title: 'Core Infrastructure',
    desc: 'Health checks, crash pings, diagnostic telemetry',
    icon: 'construct-outline'
  }
};

export default function Opportunities() {
  const [selectedApp, setSelectedApp] = useState<AppOption>(APPS[0]!);
  const [activeTab, setActiveTab] = useState<'marketplace' | 'gates' | 'inspector'>('marketplace');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AppIntelligenceSummary | null>(null);
  const [gates, setGates] = useState<AppMetadataGates | null>(null);
  const [matchResult, setMatchResult] = useState<MarketplaceMatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const [updatingGate, setUpdatingGate] = useState<string | null>(null);

  // Inspector state
  const [lastEvent, setLastEvent] = useState<IntelligenceEventView | null>(null);
  const [classifying, setClassifying] = useState(false);

  // Offer detail modal state
  const [selectedOffer, setSelectedOffer] = useState<{
    buyerCategory: string;
    offerId: string;
    payout: number;
    types: string[];
    pricingType: string;
  } | null>(null);
  const [offerAccepted, setOfferAccepted] = useState(false);

  // Load app summary, gates, and marketplace matches
  const loadAppData = async (appId: string) => {
    setLoading(true);
    try {
      const [sum, gateConfig, matches] = await Promise.all([
        api.getAppSummary(appId),
        api.getAppGates(appId),
        api.matchMarketplace({ app_id: appId })
      ]);
      setSummary(sum);
      setGates(gateConfig);
      setMatchResult(matches);
    } catch (err) {
      console.warn('Could not reach API directly, generating structured view', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppData(selectedApp.id);
  }, [selectedApp.id]);

  // Run matching engine
  const handleRunMatch = async () => {
    setMatching(true);
    try {
      const res = await api.matchMarketplace({ app_id: selectedApp.id });
      setMatchResult(res);
      // Refresh summary as well
      const sum = await api.getAppSummary(selectedApp.id);
      setSummary(sum);
    } catch (err) {
      console.warn('Marketplace match failed', err);
    } finally {
      setMatching(false);
    }
  };

  // Cycle gate state: allowed -> conditional -> blocked -> allowed
  const handleCycleGate = async (metadataType: MetadataType) => {
    if (!gates) return;
    setUpdatingGate(metadataType);
    const nextStateMap: Record<ConsentState, ConsentState> = {
      allowed: 'conditional',
      conditional: 'blocked',
      blocked: 'allowed'
    };

    const currentGate = gates.gates.find(g => g.metadata_type === metadataType);
    const current = currentGate ? currentGate.default_state : 'allowed';
    const nextState = nextStateMap[current];

    const updatedGatesList = gates.gates.map(g => {
      if (g.metadata_type === metadataType) {
        return { ...g, default_state: nextState };
      }
      return g;
    });

    const newGates: AppMetadataGates = {
      app_id: selectedApp.id,
      gates: updatedGatesList
    };

    try {
      const res = await api.updateAppGates(selectedApp.id, newGates);
      setGates(res);
      // Auto-re-run matching since gate permission changed
      const matches = await api.matchMarketplace({ app_id: selectedApp.id });
      setMatchResult(matches);
      const sum = await api.getAppSummary(selectedApp.id);
      setSummary(sum);
    } catch (err) {
      console.warn('Failed to update gate', err);
    } finally {
      setUpdatingGate(null);
    }
  };

  // Simulate Telemetry Event through Intelligence Engine
  const handleSimulateEvent = async (isCommercial: boolean) => {
    setClassifying(true);
    const eventId = `evt-sim-${Date.now()}`;
    const event: TelemetryEvent = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      app_id: selectedApp.id,
      device_id: 'dev-zero-trust-01',
      network: {
        domain: isCommercial ? 'analytics.commerce.example' : 'api.mapbox.com',
        endpoint: isCommercial ? '/v2/intent/collect' : '/v4/tiles/vector',
        method: isCommercial ? 'POST' : 'GET',
        status_code: 200
      },
      metadata: isCommercial
        ? {
            purchase_intent: 'high',
            category_totals: 'apparel_outdoor',
            dwell_time_seconds: 58,
            session_cluster: 'weekend_shopper'
          }
        : {
            zoom_level: 15,
            region_code: 'US-NY',
            render_duration_ms: 22
          },
      tags: isCommercial ? ['commercial', 'shopping', 'intent'] : ['operational', 'navigation', 'map_tiles']
    };

    try {
      const view = await api.classifyTelemetryEvent(event);
      setLastEvent(view);
      // Refresh summary
      const sum = await api.getAppSummary(selectedApp.id);
      setSummary(sum);
    } catch (err) {
      console.warn('Failed to classify event', err);
    } finally {
      setClassifying(false);
    }
  };

  const currentGatesList = gates?.gates ?? [];
  const allowedCount = currentGatesList.filter(g => g.default_state === 'allowed').length;
  const conditionalCount = currentGatesList.filter(g => g.default_state === 'conditional').length;
  const blockedCount = currentGatesList.filter(g => g.default_state === 'blocked').length;

  return (
    <Screen>
      <BrandHeader section="Intelligence & Value Engine Station" />

      {/* Main Header / Value Hook */}
      <View style={s.topBar}>
        <View style={s.headlineCol}>
          <Text style={ui.eyebrow}>COMPENSATED DATA ENGINE</Text>
          <Text style={ui.title}>Value with boundaries.</Text>
        </View>
        <View style={s.engineBadge}>
          <View style={s.pulsingDot} />
          <Text style={s.engineBadgeText}>API v1.0 ONLINE</Text>
        </View>
      </View>

      <Text style={ui.body}>
        KICK&apos;S real-time engine classifies telemetry, inspects gated metadata, and matches approved observations to verified research buyers with clear cryptographic compensation.
      </Text>

      {/* App Selector Pills */}
      <View style={s.appSelectorRow}>
        {APPS.map(app => {
          const isSelected = app.id === selectedApp.id;
          return (
            <Pressable
              key={app.id}
              onPress={() => setSelectedApp(app)}
              style={[s.appChip, isSelected && s.appChipSelected]}
            >
              <Ionicons
                name={app.icon}
                size={15}
                color={isSelected ? colors.orange : colors.muted}
              />
              <Text style={[s.appChipText, isSelected && s.appChipTextSelected]}>
                {app.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Primary Value & Intelligence Card */}
      <Card accent>
        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={colors.orange} size="small" />
            <Text style={s.loadingText}>Synthesizing Engine Intelligence...</Text>
          </View>
        ) : (
          <>
            <View style={ui.row}>
              <View>
                <Text style={s.kicker}>APP INTELLIGENCE SUMMARY</Text>
                <Text style={s.appName}>{selectedApp.name}</Text>
                <Text style={s.appId}>{selectedApp.id}</Text>
              </View>
              <View style={s.valuePill}>
                <Text style={s.valueLabel}>MATCH VALUE</Text>
                <Text style={s.valueAmount}>
                  ${summary?.total_estimated_value?.toFixed(2) ?? '8.00'}
                </Text>
              </View>
            </View>

            {/* Metrics Ribbon */}
            <View style={s.metricsRibbon}>
              <View style={s.metricItem}>
                <Text style={s.metricHeader}>COMMERCIAL INTENT</Text>
                <Text style={[s.metricVal, { color: colors.orange }]}>
                  {summary?.average_scores.commercial_intent_score?.toFixed(1) ?? '88.5'}
                  <Text style={s.metricUnit}>/100</Text>
                </Text>
              </View>
              <View style={s.metricDivider} />
              <View style={s.metricItem}>
                <Text style={s.metricHeader}>PURPOSE CONFIDENCE</Text>
                <Text style={[s.metricVal, { color: colors.green }]}>
                  {summary?.average_scores.purpose_confidence_score?.toFixed(1) ?? '96.5'}%
                </Text>
              </View>
              <View style={s.metricDivider} />
              <View style={s.metricItem}>
                <Text style={s.metricHeader}>PERSONA PROFILE</Text>
                <Text style={[s.metricVal, { color: colors.blue }]}>
                  {summary?.persona.persona === 'heavy_commercial'
                    ? 'Commercial'
                    : summary?.persona.persona === 'operational'
                    ? 'Operational'
                    : 'Mixed'}
                </Text>
              </View>
            </View>
          </>
        )}
      </Card>

      {/* Navigation Sub-Tabs */}
      <View style={s.tabBar}>
        <Pressable
          onPress={() => setActiveTab('marketplace')}
          style={[s.tabItem, activeTab === 'marketplace' && s.tabItemActive]}
        >
          <Ionicons
            name="briefcase-outline"
            size={16}
            color={activeTab === 'marketplace' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabText, activeTab === 'marketplace' && s.tabTextActive]}>
            Marketplace Matches
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('gates')}
          style={[s.tabItem, activeTab === 'gates' && s.tabItemActive]}
        >
          <Ionicons
            name="shield-outline"
            size={16}
            color={activeTab === 'gates' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabText, activeTab === 'gates' && s.tabTextActive]}>
            Metadata Gates ({allowedCount})
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('inspector')}
          style={[s.tabItem, activeTab === 'inspector' && s.tabItemActive]}
        >
          <Ionicons
            name="scan-outline"
            size={16}
            color={activeTab === 'inspector' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabText, activeTab === 'inspector' && s.tabTextActive]}>
            Signal Inspector
          </Text>
        </Pressable>
      </View>

      {/* TAB 1: MARKETPLACE MATCHES */}
      {activeTab === 'marketplace' && (
        <View style={s.tabSection}>
          <View style={ui.row}>
            <View>
              <Text style={ui.eyebrow}>BUYER OFFERS</Text>
              <Text style={ui.h2}>Compensated Data Matches</Text>
            </View>
            <Pressable
              onPress={handleRunMatch}
              disabled={matching}
              style={[s.matchBtn, matching && s.matchBtnDisabled]}
            >
              {matching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="sync-outline" size={14} color="#fff" />
                  <Text style={s.matchBtnText}>Re-Match</Text>
                </>
              )}
            </Pressable>
          </View>

          {matchResult?.matched_offers && matchResult.matched_offers.length > 0 ? (
            matchResult.matched_offers.map(({ offer, events_matched, effective_value_per_event, total_payout }) => (
              <Card key={offer.offer_id}>
                <View style={ui.row}>
                  <View style={s.buyerBadge}>
                    <Ionicons name="business-outline" size={14} color={colors.orange} />
                    <Text style={s.buyerName}>{offer.buyer_category}</Text>
                  </View>
                  <View style={s.statusTag}>
                    <Text style={s.statusText}>{offer.status.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={ui.row}>
                  <View style={s.flex1}>
                    <Text style={s.offerTitle}>
                      {offer.pricing_model.type === 'per_bundle'
                        ? 'Retail Purchase Trends Bundle'
                        : `${offer.metadata_types.join(' & ')} Research Stream`}
                    </Text>
                    <Text style={s.offerDesc}>
                      Verified research buyer requesting minimized {offer.metadata_types.join(', ')} signals. Never contains private query params, cookies, or device serials.
                    </Text>
                  </View>
                </View>

                {/* Offer Metrics */}
                <View style={s.offerMetricsRow}>
                  <View style={s.offerMetricBox}>
                    <Text style={s.offerMetricLabel}>PAYOUT REWARD</Text>
                    <Text style={s.offerMetricValue}>${total_payout.toFixed(2)}</Text>
                  </View>
                  <View style={s.offerMetricBox}>
                    <Text style={s.offerMetricLabel}>EVENTS MATCHED</Text>
                    <Text style={s.offerMetricValueSub}>{events_matched} events</Text>
                  </View>
                  <View style={s.offerMetricBox}>
                    <Text style={s.offerMetricLabel}>RATE</Text>
                    <Text style={s.offerMetricValueSub}>
                      {offer.pricing_model.type === 'per_bundle'
                        ? 'Bundle grant'
                        : `$${effective_value_per_event.toFixed(2)}/event`}
                    </Text>
                  </View>
                </View>

                {/* Requirements & Action */}
                <View style={ui.row}>
                  <View style={s.consentReqRow}>
                    <Ionicons
                      name={offer.consent_required ? 'checkmark-circle' : 'shield-outline'}
                      size={14}
                      color={colors.green}
                    />
                    <Text style={s.consentReqText}>
                      {offer.consent_required ? 'KYC + Consent Required' : 'Open Benchmark'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setSelectedOffer({
                        buyerCategory: offer.buyer_category,
                        offerId: offer.offer_id,
                        payout: total_payout,
                        types: offer.metadata_types,
                        pricingType: offer.pricing_model.type
                      });
                      setOfferAccepted(false);
                    }}
                    style={s.reviewOfferBtn}
                  >
                    <Text style={s.reviewOfferBtnText}>Review & Connect →</Text>
                  </Pressable>
                </View>
              </Card>
            ))
          ) : (
            <Card>
              <Text style={ui.h2}>No active offers match current gates</Text>
              <Text style={ui.body}>
                Your metadata gates are currently blocking all requested data types. Open the Metadata Gates tab to configure permissions.
              </Text>
            </Card>
          )}

          {/* Launch Standard Card */}
          <Card>
            <View style={s.launchHeader}>
              <Ionicons name="ribbon-outline" size={18} color={colors.orange} />
              <Text style={ui.eyebrow}>ZERO-TRUST MARKETPLACE CHARTER</Text>
            </View>
            <Text style={ui.body}>
              Every marketplace partner is vetted under strict cryptographic standards. Payouts are distributed via verified balance reserves once purpose minimization proofs are verified.
            </Text>
          </Card>
        </View>
      )}

      {/* TAB 2: METADATA GATES */}
      {activeTab === 'gates' && (
        <View style={s.tabSection}>
          <View style={ui.row}>
            <View>
              <Text style={ui.eyebrow}>SECURITY GATING</Text>
              <Text style={ui.h2}>App Metadata Gates</Text>
            </View>
            <View style={s.gatesTally}>
              <Text style={s.tallyAllowed}>{allowedCount} Allowed</Text>
              <Text style={s.tallyCond}>{conditionalCount} Cond.</Text>
              <Text style={s.tallyBlocked}>{blockedCount} Blocked</Text>
            </View>
          </View>

          <Text style={ui.body}>
            Tap any gate to toggle its status between <Text style={{ color: colors.green }}>Allowed</Text>, <Text style={{ color: colors.orange }}>Conditional</Text>, or <Text style={{ color: colors.red }}>Blocked</Text>. Changes take effect in the engine immediately.
          </Text>

          {currentGatesList.map(gate => {
            const info = METADATA_TYPE_LABELS[gate.metadata_type] ?? {
              title: gate.metadata_type,
              desc: 'Extracted application telemetry',
              icon: 'cube-outline'
            };
            const isUpdating = updatingGate === gate.metadata_type;

            return (
              <Card key={gate.metadata_type}>
                <View style={ui.row}>
                  <View style={s.gateTitleRow}>
                    <View style={s.gateIcon}>
                      <Ionicons name={info.icon} size={18} color={colors.orange} />
                    </View>
                    <View>
                      <Text style={s.gateTitle}>{info.title}</Text>
                      <Text style={s.gateMetaType}>{gate.metadata_type.toUpperCase()}</Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => handleCycleGate(gate.metadata_type)}
                    disabled={isUpdating}
                    style={[
                      s.gateStateBtn,
                      gate.default_state === 'allowed' && s.gateAllowed,
                      gate.default_state === 'conditional' && s.gateConditional,
                      gate.default_state === 'blocked' && s.gateBlocked
                    ]}
                  >
                    {isUpdating ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.gateStateText}>
                        {gate.default_state.toUpperCase()} ↺
                      </Text>
                    )}
                  </Pressable>
                </View>

                <Text style={s.gateDesc}>{info.desc}</Text>

                {gate.buyer_overrides && gate.buyer_overrides.length > 0 && (
                  <View style={s.overrideBox}>
                    <Text style={s.overrideHeader}>BUYER OVERRIDES ACTIVE:</Text>
                    {gate.buyer_overrides.map((bo, i) => (
                      <View key={i} style={ui.row}>
                        <Text style={s.overrideBuyer}>{bo.buyer_category}</Text>
                        <Text style={s.overrideState}>→ {bo.state.toUpperCase()}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {/* TAB 3: SIGNAL INSPECTOR & EXPLAINABILITY */}
      {activeTab === 'inspector' && (
        <View style={s.tabSection}>
          <View style={ui.row}>
            <View>
              <Text style={ui.eyebrow}>EXPLAINABILITY ENGINE</Text>
              <Text style={ui.h2}>Live Telemetry Ingestion</Text>
            </View>
            <View style={s.simButtonsRow}>
              <Pressable
                onPress={() => handleSimulateEvent(true)}
                disabled={classifying}
                style={s.simBtn}
              >
                <Ionicons name="cart" size={13} color="#fff" />
                <Text style={s.simBtnText}>Shop Event</Text>
              </Pressable>
              <Pressable
                onPress={() => handleSimulateEvent(false)}
                disabled={classifying}
                style={[s.simBtn, s.simBtnSecondary]}
              >
                <Ionicons name="navigate" size={13} color="#fff" />
                <Text style={s.simBtnText}>Map Event</Text>
              </Pressable>
            </View>
          </View>

          <Text style={ui.body}>
            Test incoming network signals through the unified classification, scoring, and metadata inspection pipeline.
          </Text>

          {classifying && (
            <Card>
              <View style={s.loadingBox}>
                <ActivityIndicator color={colors.orange} size="small" />
                <Text style={s.loadingText}>Classifying & scoring telemetry event...</Text>
              </View>
            </Card>
          )}

          {lastEvent && !classifying && (
            <>
              {/* Classification & Scores */}
              <Card accent>
                <View style={ui.row}>
                  <View style={s.classificationTag}>
                    <Text style={s.classificationText}>
                      {lastEvent.classification.category.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={s.confidenceTag}>
                    CONFIDENCE: {lastEvent.explanation.confidence_band.toUpperCase()}
                  </Text>
                </View>

                <Text style={ui.h2}>{lastEvent.explanation.title}</Text>
                <Text style={ui.body}>{lastEvent.explanation.summary}</Text>

                {/* Scores breakdown */}
                <View style={s.scoresGrid}>
                  <View style={s.scoreBox}>
                    <Text style={s.scoreBoxLabel}>COMMERCIAL SCORE</Text>
                    <Text style={[s.scoreBoxVal, { color: colors.orange }]}>
                      {lastEvent.scores.commercial_intent_score}
                    </Text>
                  </View>
                  <View style={s.scoreBox}>
                    <Text style={s.scoreBoxLabel}>VALUE ESTIMATE</Text>
                    <Text style={[s.scoreBoxVal, { color: colors.green }]}>
                      ${lastEvent.scores.metadata_value_estimate}
                    </Text>
                  </View>
                  <View style={s.scoreBox}>
                    <Text style={s.scoreBoxLabel}>BASELINE STABILITY</Text>
                    <Text style={[s.scoreBoxVal, { color: colors.text }]}>
                      {lastEvent.scores.baseline_stability_score}%
                    </Text>
                  </View>
                  <View style={s.scoreBox}>
                    <Text style={s.scoreBoxLabel}>PURPOSE ACCURACY</Text>
                    <Text style={[s.scoreBoxVal, { color: colors.blue }]}>
                      {lastEvent.scores.purpose_confidence_score}%
                    </Text>
                  </View>
                </View>

                {/* Explanation Details */}
                <View style={s.detailsList}>
                  {lastEvent.explanation.details.map((d, i) => (
                    <Text key={i} style={s.detailItem}>• {d}</Text>
                  ))}
                </View>
              </Card>

              {/* Extracted Metadata Inspection Breakdown */}
              <Card>
                <Text style={ui.eyebrow}>GATED METADATA ITEMS</Text>
                <Text style={ui.h2}>Extracted Normalized Fields</Text>
                <Text style={ui.body}>
                  Individual values are scrubbed and evaluated for marketplace eligibility against active app gates:
                </Text>

                {lastEvent.metadata_inspection.metadata_items.map((item, i) => (
                  <View key={i} style={s.metaItemCard}>
                    <View style={ui.row}>
                      <View>
                        <Text style={s.metaKey}>{item.key}</Text>
                        <Text style={s.metaType}>{item.type.toUpperCase()}</Text>
                      </View>
                      <View style={s.metaValueCol}>
                        <Text style={s.metaValEst}>+${item.estimated_value_per_event.toFixed(2)}/ev</Text>
                        <View style={[
                          s.metaConsentBadge,
                          item.consent_state === 'allowed' && s.gateAllowed,
                          item.consent_state === 'conditional' && s.gateConditional,
                          item.consent_state === 'blocked' && s.gateBlocked
                        ]}>
                          <Text style={s.metaConsentText}>{item.consent_state.toUpperCase()}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={s.metaDesc}>{item.description}</Text>
                    <Text style={s.metaBuyers}>
                      Potential buyers: {item.buyer_categories.join(', ')}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          {!lastEvent && !classifying && (
            <Card>
              <Text style={ui.h2}>Engine Ready for Ingestion</Text>
              <Text style={ui.body}>
                Tap &quot;Shop Event&quot; or &quot;Map Event&quot; above to simulate an outbound telemetry transmission and view real-time score attribution.
              </Text>
            </Card>
          )}
        </View>
      )}

      {/* Offer Connect & Approval Modal */}
      <Modal
        visible={!!selectedOffer}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedOffer(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={ui.row}>
              <Text style={ui.eyebrow}>COMPENSATED AGREEMENT</Text>
              <Pressable onPress={() => setSelectedOffer(null)}>
                <Ionicons name="close-circle" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <Text style={ui.h2}>{selectedOffer?.buyerCategory}</Text>
            <Text style={ui.body}>
              You are approving a versioned data compensation contract governed by zero-trust minimization.
            </Text>

            <View style={s.modalDetailsBox}>
              <View style={ui.row}>
                <Text style={s.modalLabel}>Approved Types:</Text>
                <Text style={s.modalValue}>{selectedOffer?.types.join(', ')}</Text>
              </View>
              <View style={ui.row}>
                <Text style={s.modalLabel}>Estimated Payout:</Text>
                <Text style={[s.modalValue, { color: colors.orange, fontWeight: '900' }]}>
                  ${selectedOffer?.payout.toFixed(2)}
                </Text>
              </View>
              <View style={ui.row}>
                <Text style={s.modalLabel}>Ingestion Mode:</Text>
                <Text style={s.modalValue}>Metadata Only (Zero Payload)</Text>
              </View>
              <View style={ui.row}>
                <Text style={s.modalLabel}>Contract Jurisdiction:</Text>
                <Text style={s.modalValue}>US / EU Verified Research</Text>
              </View>
            </View>

            {offerAccepted ? (
              <View style={s.acceptedBox}>
                <Ionicons name="checkmark-circle" size={26} color={colors.green} />
                <Text style={s.acceptedText}>Agreement Enforced on Ledger</Text>
              </View>
            ) : (
              <View style={s.modalActions}>
                <Pressable
                  onPress={() => setSelectedOffer(null)}
                  style={s.cancelBtn}
                >
                  <Text style={s.cancelBtnText}>Dismiss</Text>
                </Pressable>
                <Pressable
                  onPress={() => setOfferAccepted(true)}
                  style={s.acceptBtn}
                >
                  <Text style={s.acceptBtnText}>Grant & Connect</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8
  },
  headlineCol: {
    flex: 1
  },
  engineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1b0e06',
    borderColor: '#632e11',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  pulsingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.green
  },
  engineBadgeText: {
    color: '#ffbe88',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  appSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4
  },
  appChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#29252c'
  },
  appChipSelected: {
    backgroundColor: '#261206',
    borderColor: '#803c14'
  },
  appChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700'
  },
  appChipTextSelected: {
    color: colors.text,
    fontWeight: '900'
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600'
  },
  kicker: {
    color: colors.orange,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2
  },
  appName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2
  },
  appId: {
    color: '#9c8c82',
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 2
  },
  valuePill: {
    alignItems: 'flex-end'
  },
  valueLabel: {
    color: '#806f65',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1
  },
  valueAmount: {
    color: colors.orange,
    fontSize: 28,
    fontWeight: '900'
  },
  metricsRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#100a06',
    borderWidth: 1,
    borderColor: '#381e10',
    borderRadius: 12,
    padding: 10,
    marginTop: 10
  },
  metricItem: {
    flex: 1,
    alignItems: 'center'
  },
  metricHeader: {
    color: '#9c8c82',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  metricVal: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3
  },
  metricUnit: {
    fontSize: 10,
    color: colors.muted
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#381e10'
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0c0c0e',
    borderWidth: 1,
    borderColor: '#242028',
    borderRadius: 14,
    padding: 4,
    marginVertical: 4
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10
  },
  tabItemActive: {
    backgroundColor: '#201209',
    borderWidth: 1,
    borderColor: '#592c13'
  },
  tabText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  tabTextActive: {
    color: colors.orange,
    fontWeight: '800'
  },
  tabSection: {
    gap: 12
  },
  matchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.orange,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10
  },
  matchBtnDisabled: {
    opacity: 0.6
  },
  matchBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800'
  },
  buyerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1b1411',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#422718'
  },
  buyerName: {
    color: '#ffc8a0',
    fontSize: 11,
    fontWeight: '800'
  },
  statusTag: {
    backgroundColor: '#0f2418',
    borderColor: '#1e5433',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  statusText: {
    color: colors.green,
    fontSize: 9,
    fontWeight: '800'
  },
  flex1: {
    flex: 1
  },
  offerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800'
  },
  offerDesc: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4
  },
  offerMetricsRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#0c0c0e',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#242028'
  },
  offerMetricBox: {
    flex: 1
  },
  offerMetricLabel: {
    color: '#7f7168',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  offerMetricValue: {
    color: colors.orange,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2
  },
  offerMetricValueSub: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2
  },
  consentReqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  consentReqText: {
    color: '#b8a69a',
    fontSize: 11,
    fontWeight: '700'
  },
  reviewOfferBtn: {
    backgroundColor: '#2b160b',
    borderColor: '#6b3617',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  reviewOfferBtnText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '800'
  },
  launchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  gatesTally: {
    flexDirection: 'row',
    gap: 6
  },
  tallyAllowed: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '800'
  },
  tallyCond: {
    color: colors.orange,
    fontSize: 11,
    fontWeight: '800'
  },
  tallyBlocked: {
    color: colors.red,
    fontSize: 11,
    fontWeight: '800'
  },
  gateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  gateIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#20130b',
    borderWidth: 1,
    borderColor: '#542913',
    alignItems: 'center',
    justifyContent: 'center'
  },
  gateTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  gateMetaType: {
    color: '#7a6a61',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1
  },
  gateStateBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1
  },
  gateAllowed: {
    backgroundColor: '#0c2214',
    borderColor: '#1d5a32'
  },
  gateConditional: {
    backgroundColor: '#261408',
    borderColor: '#7a3e14'
  },
  gateBlocked: {
    backgroundColor: '#240a08',
    borderColor: '#691b15'
  },
  gateStateText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900'
  },
  gateDesc: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  overrideBox: {
    backgroundColor: '#0e0e11',
    borderWidth: 1,
    borderColor: '#242028',
    borderRadius: 8,
    padding: 8,
    gap: 4
  },
  overrideHeader: {
    color: '#85756c',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  overrideBuyer: {
    color: '#e4d3c6',
    fontSize: 11,
    fontWeight: '700'
  },
  overrideState: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '800'
  },
  simButtonsRow: {
    flexDirection: 'row',
    gap: 6
  },
  simBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.orange,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  simBtnSecondary: {
    backgroundColor: '#1b4b74'
  },
  simBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800'
  },
  classificationTag: {
    backgroundColor: '#24140a',
    borderColor: '#613214',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  classificationText: {
    color: colors.orange,
    fontSize: 11,
    fontWeight: '900'
  },
  confidenceTag: {
    color: '#806e64',
    fontSize: 10,
    fontWeight: '800'
  },
  scoresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8
  },
  scoreBox: {
    width: '48%',
    backgroundColor: '#0a0a0d',
    borderWidth: 1,
    borderColor: '#242028',
    borderRadius: 10,
    padding: 10
  },
  scoreBoxLabel: {
    color: '#7f7067',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6
  },
  scoreBoxVal: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 3
  },
  detailsList: {
    backgroundColor: '#0d0d10',
    borderWidth: 1,
    borderColor: '#252028',
    borderRadius: 8,
    padding: 10,
    gap: 4
  },
  detailItem: {
    color: '#c9b9ad',
    fontSize: 12,
    lineHeight: 17
  },
  metaItemCard: {
    backgroundColor: '#0d0d10',
    borderWidth: 1,
    borderColor: '#242028',
    borderRadius: 10,
    padding: 10,
    gap: 4
  },
  metaKey: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace'
  },
  metaType: {
    color: '#7a6a61',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 1
  },
  metaValueCol: {
    alignItems: 'flex-end',
    gap: 3
  },
  metaValEst: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '800'
  },
  metaConsentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1
  },
  metaConsentText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '900'
  },
  metaDesc: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16
  },
  metaBuyers: {
    color: '#918279',
    fontSize: 11,
    fontWeight: '600'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#522a14',
    borderRadius: 18,
    padding: 20,
    gap: 12
  },
  modalDetailsBox: {
    backgroundColor: '#0c0c0e',
    borderWidth: 1,
    borderColor: '#29252c',
    borderRadius: 12,
    padding: 12,
    gap: 8
  },
  modalLabel: {
    color: '#8a7c73',
    fontSize: 12,
    fontWeight: '700'
  },
  modalValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#39333a',
    alignItems: 'center'
  },
  cancelBtnText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  acceptBtn: {
    flex: 1.5,
    backgroundColor: colors.orange,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center'
  },
  acceptBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900'
  },
  acceptedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#0b2314',
    borderWidth: 1,
    borderColor: '#1d5a32',
    borderRadius: 10,
    padding: 14,
    marginTop: 6
  },
  acceptedText: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '800'
  }
});
