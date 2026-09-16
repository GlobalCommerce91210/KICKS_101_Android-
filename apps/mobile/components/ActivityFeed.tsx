import { useState, useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Card, colors, ui } from './Brand';

export type ActivityType = 'connection' | 'privacy';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  sourceApp: string;
  target: string;
  category: 'location' | 'telemetry' | 'advertising' | 'consent' | 'zero_trust' | 'policy';
  detail: string;
  timestamp: string;
  status: 'Expected' | 'Review' | 'Blocked' | 'Enforced' | 'Granted';
  protocol?: string;
  bytesBucket?: string;
  attribution?: 'verified' | 'best_effort';
  isLive?: boolean;
}

const INITIAL_ACTIVITIES: ActivityItem[] = [
  {
    id: 'act-001',
    type: 'connection',
    title: 'Location Metadata Signal',
    sourceApp: 'Transit Map',
    target: 'api.mapbox.com',
    category: 'location',
    detail: 'Vector tile coordinates and approximate region transmitted. Classified as expected navigation telemetry without identity identifiers.',
    timestamp: 'Just now',
    status: 'Expected',
    protocol: 'TLS 1.3',
    bytesBucket: '10-100KB',
    attribution: 'verified'
  },
  {
    id: 'act-002',
    type: 'connection',
    title: 'Ad Identifier Telemetry',
    sourceApp: 'Shop Sample',
    target: 'events.analytics.example',
    category: 'telemetry',
    detail: 'Device session duration and commercial interest tags contacted an unverified analytics collector. Review recommended.',
    timestamp: '3m ago',
    status: 'Review',
    protocol: 'HTTPS',
    bytesBucket: '1-10KB',
    attribution: 'best_effort'
  },
  {
    id: 'act-003',
    type: 'privacy',
    title: 'Zero-Trust Replay Blocked',
    sourceApp: 'KICK\'S Ingestion Gate',
    target: 'api/v1/metadata-batches',
    category: 'zero_trust',
    detail: 'Detected duplicate metadata batch ID replay attempt. Request automatically dropped and flagged under zero-trust verification.',
    timestamp: '14m ago',
    status: 'Enforced',
    protocol: 'mTLS',
    bytesBucket: '0-1KB',
    attribution: 'verified'
  },
  {
    id: 'act-004',
    type: 'privacy',
    title: 'Commercial Consent Grant',
    sourceApp: 'Research Partner A',
    target: 'Retail Purchase Trends',
    category: 'consent',
    detail: 'Signed and appended 30-day consent grant to ledger. Compensated opportunity value locked at $8.00.',
    timestamp: '28m ago',
    status: 'Granted',
    protocol: 'Ledger Event',
    bytesBucket: '0-1KB',
    attribution: 'verified'
  },
  {
    id: 'act-005',
    type: 'connection',
    title: 'Third-Party Ad Broker Blocked',
    sourceApp: 'News Reader Pro',
    target: 'ads.track-nexus.com',
    category: 'advertising',
    detail: 'Attempted outbound connection to known behavioral advertising domain blocked by active firewall filter.',
    timestamp: '42m ago',
    status: 'Blocked',
    protocol: 'QUIC',
    bytesBucket: '0-1KB',
    attribution: 'verified'
  },
  {
    id: 'act-006',
    type: 'connection',
    title: 'Weather Coordinates Polling',
    sourceApp: 'Weather Widget',
    target: 'api.weather.example',
    category: 'location',
    detail: 'Coarse city-level weather forecast inquiry. Verified no persistent device identifiers or GPS trails attached.',
    timestamp: '1h ago',
    status: 'Expected',
    protocol: 'TLS 1.3',
    bytesBucket: '1-10KB',
    attribution: 'verified'
  },
  {
    id: 'act-007',
    type: 'privacy',
    title: 'Policy Ledger Audit',
    sourceApp: 'KICK\'S Engine',
    target: 'Consent v2026-08-01',
    category: 'policy',
    detail: 'Audited 47 destination domains against active permission contracts. Payload minimization validated with 0 plaintext leaks.',
    timestamp: '2h ago',
    status: 'Enforced',
    protocol: 'Zero-Trust Audit',
    bytesBucket: '0-1KB',
    attribution: 'verified'
  }
];

const SIMULATED_POOL: ActivityItem[] = [
  {
    id: 'act-sim-1',
    type: 'connection',
    title: 'Diagnostic Crash Ping',
    sourceApp: 'Audio Streamer',
    target: 'crash.diagnostics.io',
    category: 'telemetry',
    detail: 'Anonymized stack trace and memory pressure state dispatched during app launch. No audio buffer data included.',
    timestamp: 'Just now',
    status: 'Expected',
    protocol: 'TLS 1.3',
    bytesBucket: '1-10KB',
    attribution: 'verified',
    isLive: true
  },
  {
    id: 'act-sim-2',
    type: 'privacy',
    title: 'Broker Query Denied',
    sourceApp: 'Game Hub',
    target: 'sync.adtracker.net',
    category: 'zero_trust',
    detail: 'Unsolicited identity synchronization blocked because user has not granted ad-matching permissions.',
    timestamp: 'Just now',
    status: 'Blocked',
    protocol: 'DNS Sinkhole',
    bytesBucket: '0-1KB',
    attribution: 'verified',
    isLive: true
  },
  {
    id: 'act-sim-3',
    type: 'privacy',
    title: 'Device Token Cycled',
    sourceApp: 'KICK\'S Collector',
    target: 'Device Staging Auth',
    category: 'policy',
    detail: 'Zero-trust bearer token rotation completed successfully. Stored credential hash refreshed.',
    timestamp: 'Just now',
    status: 'Enforced',
    protocol: 'SHA-256 Auth',
    bytesBucket: '0-1KB',
    attribution: 'verified',
    isLive: true
  }
];

type FilterType = 'all' | 'connection' | 'privacy' | 'review';

export function ActivityFeed() {
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>(INITIAL_ACTIVITIES);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [simIndex, setSimIndex] = useState(0);

  const simulateNewEvent = () => {
    const nextItem = SIMULATED_POOL[simIndex % SIMULATED_POOL.length];
    if (!nextItem) return;
    const newItem: ActivityItem = {
      ...nextItem,
      id: `act-${Date.now()}`,
      timestamp: 'Just now'
    };
    setItems(prev => [newItem, ...prev.slice(0, 15)]);
    setSimIndex(v => v + 1);
  };

  const counts = useMemo(() => {
    return {
      all: items.length,
      connection: items.filter(i => i.type === 'connection').length,
      privacy: items.filter(i => i.type === 'privacy').length,
      review: items.filter(i => i.status === 'Review').length
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter === 'connection' && item.type !== 'connection') return false;
      if (filter === 'privacy' && item.type !== 'privacy') return false;
      if (filter === 'review' && item.status !== 'Review') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.sourceApp.toLowerCase().includes(q) ||
          item.target.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.detail.toLowerCase().includes(q) ||
          item.status.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, filter, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <View style={feedStyles.container}>
      {/* Activity Feed Header */}
      <View style={ui.row}>
        <View>
          <Text style={ui.eyebrow}>REAL-TIME AUDIT LOG</Text>
          <Text style={ui.h2}>Activity Feed</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Inspect live engine destinations"
          onPress={() => router.push('/engine')}
          style={feedStyles.engineLink}
        >
          <Text style={ui.blue}>Engine</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.blue} />
        </Pressable>
      </View>

      {/* Overview & Quick Action Pill */}
      <View style={feedStyles.controlRow}>
        <View style={feedStyles.pulseBox}>
          <View style={feedStyles.pulseDot} />
          <Text style={feedStyles.pulseText}>
            Monitoring {items.length} signals & privacy decisions
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Simulate incoming signal"
          onPress={simulateNewEvent}
          style={feedStyles.simButton}
        >
          <Ionicons name="add-circle-outline" size={14} color={colors.orange} />
          <Text style={feedStyles.simButtonText}>Simulate Event</Text>
        </Pressable>
      </View>

      {/* Search Input */}
      <View style={feedStyles.searchBar}>
        <Ionicons name="search-outline" size={16} color="#786961" />
        <TextInput
          style={feedStyles.searchInput}
          placeholder="Filter by app, domain, or policy..."
          placeholderTextColor="#786961"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={16} color="#786961" />
          </Pressable>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={feedStyles.tabs}>
        <FilterChip
          label="All"
          count={counts.all}
          active={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <FilterChip
          label="Connections"
          count={counts.connection}
          active={filter === 'connection'}
          onPress={() => setFilter('connection')}
          icon="globe-outline"
        />
        <FilterChip
          label="Privacy Events"
          count={counts.privacy}
          active={filter === 'privacy'}
          onPress={() => setFilter('privacy')}
          icon="shield-checkmark-outline"
        />
        <FilterChip
          label="Review"
          count={counts.review}
          active={filter === 'review'}
          onPress={() => setFilter('review')}
          badgeColor={counts.review > 0 ? colors.orange : undefined}
        />
      </View>

      {/* List of Activity Items */}
      {filteredItems.length === 0 ? (
        <Card>
          <View style={feedStyles.emptyState}>
            <Ionicons name="filter-outline" size={28} color="#786961" />
            <Text style={feedStyles.emptyTitle}>No matching activities found</Text>
            <Text style={ui.body}>
              Try altering your search keywords or resetting the filter category.
            </Text>
            <Pressable
              onPress={() => {
                setFilter('all');
                setSearchQuery('');
              }}
              style={feedStyles.resetButton}
            >
              <Text style={feedStyles.resetButtonText}>Reset Filters</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        filteredItems.map(item => {
          const isExpanded = expandedId === item.id;
          return (
            <ActivityCard
              key={item.id}
              item={item}
              isExpanded={isExpanded}
              onToggle={() => toggleExpand(item.id)}
            />
          );
        })
      )}
    </View>
  );
}

function FilterChip({
  label,
  count,
  active,
  onPress,
  icon,
  badgeColor
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  badgeColor?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[feedStyles.chip, active && feedStyles.chipActive]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={12}
          color={active ? colors.orange : '#9c8c82'}
        />
      )}
      <Text style={[feedStyles.chipLabel, active && feedStyles.chipLabelActive]}>
        {label}
      </Text>
      <View
        style={[
          feedStyles.chipBadge,
          active && feedStyles.chipBadgeActive,
          badgeColor ? { backgroundColor: badgeColor } : null
        ]}
      >
        <Text
          style={[
            feedStyles.chipCount,
            active && feedStyles.chipCountActive,
            badgeColor ? { color: '#100703' } : null
          ]}
        >
          {count}
        </Text>
      </View>
    </Pressable>
  );
}

function ActivityCard({
  item,
  isExpanded,
  onToggle
}: {
  item: ActivityItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isConnection = item.type === 'connection';

  const statusStyle =
    item.status === 'Expected' || item.status === 'Granted'
      ? feedStyles.statusGood
      : item.status === 'Review'
      ? feedStyles.statusWarn
      : item.status === 'Blocked'
      ? feedStyles.statusDanger
      : feedStyles.statusInfo;

  const statusBg =
    item.status === 'Expected' || item.status === 'Granted'
      ? feedStyles.badgeGoodBg
      : item.status === 'Review'
      ? feedStyles.badgeWarnBg
      : item.status === 'Blocked'
      ? feedStyles.badgeDangerBg
      : feedStyles.badgeInfoBg;

  const iconName: keyof typeof Ionicons.glyphMap =
    item.type === 'privacy'
      ? item.category === 'consent'
        ? 'document-text-outline'
        : item.category === 'zero_trust'
        ? 'shield-half-outline'
        : 'lock-closed-outline'
      : item.category === 'location'
      ? 'navigate-outline'
      : item.category === 'advertising'
      ? 'megaphone-outline'
      : 'radio-outline';

  return (
    <Card accent={item.status === 'Review' || item.isLive}>
      <Pressable onPress={onToggle} style={feedStyles.cardPressable}>
        {/* Top line: Icon, Target & Status */}
        <View style={ui.row}>
          <View style={feedStyles.iconAndHeading}>
            <View
              style={[
                feedStyles.typeIconContainer,
                item.type === 'privacy' && feedStyles.privacyIconBg
              ]}
            >
              <Ionicons
                name={iconName}
                size={16}
                color={item.type === 'privacy' ? colors.blue : colors.orange}
              />
            </View>

            <View style={feedStyles.headingDetails}>
              <View style={feedStyles.titleRow}>
                <Text style={feedStyles.sourceApp}>{item.sourceApp}</Text>
                {item.isLive && (
                  <View style={feedStyles.newTag}>
                    <Text style={feedStyles.newTagText}>NEW</Text>
                  </View>
                )}
              </View>
              <Text style={feedStyles.targetText} numberOfLines={1}>
                {isConnection ? '→ ' + item.target : 'Purpose: ' + item.target}
              </Text>
            </View>
          </View>

          <View style={feedStyles.rightCol}>
            <View style={[feedStyles.statusBadge, statusBg]}>
              <Text style={[feedStyles.statusText, statusStyle]}>{item.status}</Text>
            </View>
            <Text style={feedStyles.timestamp}>{item.timestamp}</Text>
          </View>
        </View>

        {/* Plain Language Summary Detail */}
        <Text style={ui.body}>{item.detail}</Text>

        {/* Tags Row */}
        <View style={feedStyles.metaRow}>
          <View style={feedStyles.tagGroup}>
            <View style={feedStyles.metaTag}>
              <Text style={feedStyles.metaTagText}>
                {isConnection ? 'Data Connection' : 'Privacy Event'}
              </Text>
            </View>
            {item.protocol && (
              <View style={feedStyles.metaTag}>
                <Text style={feedStyles.metaTagText}>{item.protocol}</Text>
              </View>
            )}
            {item.bytesBucket && (
              <View style={feedStyles.metaTag}>
                <Text style={feedStyles.metaTagText}>{item.bytesBucket}</Text>
              </View>
            )}
          </View>

          <View style={feedStyles.expandIndicator}>
            <Text style={feedStyles.expandText}>
              {isExpanded ? 'Hide Specs' : 'Details'}
            </Text>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={13}
              color="#9c8c82"
            />
          </View>
        </View>

        {/* Expanded Technical & Zero-Trust Audit Panel */}
        {isExpanded && (
          <View style={feedStyles.drawer}>
            <View style={feedStyles.drawerDivider} />
            <Text style={feedStyles.drawerHeader}>TECHNICAL AUDIT SNAPSHOT</Text>

            <View style={feedStyles.specGrid}>
              <View style={feedStyles.specItem}>
                <Text style={ui.label}>EVENT ID</Text>
                <Text style={feedStyles.specValue}>{item.id}</Text>
              </View>
              <View style={feedStyles.specItem}>
                <Text style={ui.label}>ATTRIBUTION</Text>
                <Text style={feedStyles.specValue}>
                  {item.attribution === 'verified' ? 'Verified App Identity' : 'Best-Effort Route'}
                </Text>
              </View>
              <View style={feedStyles.specItem}>
                <Text style={ui.label}>ZERO-TRUST STATUS</Text>
                <Text
                  style={[
                    feedStyles.specValue,
                    item.status === 'Blocked' ? { color: colors.red } : { color: colors.green }
                  ]}
                >
                  {item.status === 'Blocked' ? 'Traffic Dropped' : 'Contract Compliant'}
                </Text>
              </View>
              <View style={feedStyles.specItem}>
                <Text style={ui.label}>PAYLOAD MINIMIZATION</Text>
                <Text style={feedStyles.specValue}>
                  Stripped at native boundary (No bodies stored)
                </Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </Card>
  );
}

const feedStyles = StyleSheet.create({
  container: {
    gap: 12,
    marginTop: 4
  },
  engineLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap'
  },
  pulseBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#160c07',
    borderColor: '#422110',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.orange
  },
  pulseText: {
    color: '#d9b69e',
    fontSize: 11,
    fontWeight: '700'
  },
  simButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1c130e',
    borderWidth: 1,
    borderColor: '#603117',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99
  },
  simButtonText: {
    color: colors.orange,
    fontSize: 11,
    fontWeight: '800'
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#141418',
    borderWidth: 1,
    borderColor: '#2d272b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    padding: 0
  },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap'
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#151518',
    borderWidth: 1,
    borderColor: '#2d2629'
  },
  chipActive: {
    backgroundColor: '#27150c',
    borderColor: '#7a3816'
  },
  chipLabel: {
    color: '#9c8c82',
    fontSize: 12,
    fontWeight: '700'
  },
  chipLabelActive: {
    color: colors.text
  },
  chipBadge: {
    backgroundColor: '#252125',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 99
  },
  chipBadgeActive: {
    backgroundColor: '#4e240f'
  },
  chipCount: {
    color: '#b09f95',
    fontSize: 10,
    fontWeight: '800'
  },
  chipCountActive: {
    color: colors.orange
  },
  cardPressable: {
    gap: 8
  },
  iconAndHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1
  },
  typeIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2b1408',
    borderWidth: 1,
    borderColor: '#6b3215',
    alignItems: 'center',
    justifyContent: 'center'
  },
  privacyIconBg: {
    backgroundColor: '#0a1a27',
    borderColor: '#114a73'
  },
  headingDetails: {
    flex: 1
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  sourceApp: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  newTag: {
    backgroundColor: colors.orange,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4
  },
  newTagText: {
    color: '#120702',
    fontSize: 9,
    fontWeight: '900'
  },
  targetText: {
    color: '#c9a891',
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'monospace'
  },
  rightCol: {
    alignItems: 'flex-end',
    gap: 3
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  badgeGoodBg: {
    backgroundColor: 'rgba(57,217,138,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(57,217,138,0.3)'
  },
  badgeWarnBg: {
    backgroundColor: 'rgba(255,106,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,0,0.3)'
  },
  badgeDangerBg: {
    backgroundColor: 'rgba(255,102,95,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,102,95,0.3)'
  },
  badgeInfoBg: {
    backgroundColor: 'rgba(22,169,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(22,169,255,0.3)'
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800'
  },
  statusGood: {
    color: colors.green
  },
  statusWarn: {
    color: colors.orange
  },
  statusDanger: {
    color: colors.red
  },
  statusInfo: {
    color: colors.blue
  },
  timestamp: {
    color: '#7e6f66',
    fontSize: 10,
    fontWeight: '700'
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4
  },
  tagGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap'
  },
  metaTag: {
    backgroundColor: '#1a181d',
    borderWidth: 1,
    borderColor: '#2e2830',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5
  },
  metaTagText: {
    color: '#a39389',
    fontSize: 10,
    fontWeight: '700'
  },
  expandIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3
  },
  expandText: {
    color: '#9c8c82',
    fontSize: 11,
    fontWeight: '700'
  },
  drawer: {
    gap: 8,
    marginTop: 4
  },
  drawerDivider: {
    height: 1,
    backgroundColor: '#272024'
  },
  drawerHeader: {
    color: colors.orange,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1
  },
  specGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: '#0a0a0c',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#211c20'
  },
  specItem: {
    width: '47%'
  },
  specValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 18,
    gap: 8
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800'
  },
  resetButton: {
    marginTop: 6,
    backgroundColor: '#291409',
    borderWidth: 1,
    borderColor: '#713615',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  resetButtonText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '800'
  }
});
