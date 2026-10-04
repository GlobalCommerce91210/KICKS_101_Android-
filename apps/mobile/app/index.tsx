import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BrandHeader, Card, MascotHero, Screen, colors, ui } from '../components/Brand';
import { LiveEngineSnapshotCore, loadLiveEngineSnapshot } from '../components/live-engine';

type BehaviorTier = 'operational' | 'behavioral' | 'unexpected' | 'unknown';
type ActivityObservation = {
  observationId: string;
  observedAt: string;
  sourceApp: string | null;
  sourceAppName: string | null;
  company: string;
  destinationDomain: string;
  purpose: string;
  commercialFunction: string;
  behaviorTier: BehaviorTier;
  plainLanguageSummary: string;
  frequency: number;
  confidence: number;
  consentStatus: 'active' | 'inactive' | 'missing';
};
type ActivitySnapshot = Omit<LiveEngineSnapshotCore, 'observations'> & {
  observations: ActivityObservation[];
};

const tierColors: Record<BehaviorTier, string> = {
  operational: '#9b918b', behavioral: colors.orange, unexpected: colors.red, unknown: '#ffcf4a',
};
const tierLabels: Record<BehaviorTier, string> = {
  operational: 'Routine', behavioral: 'Value', unexpected: 'Alert', unknown: 'Investigate',
};

export default function Activity() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (showIndicator = true) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (showIndicator) setLoading(true);
    try {
      const next = await loadLiveEngineSnapshot<ActivitySnapshot>({ force: showIndicator });
      setSnapshot(next);
      setLastRefreshedAt(new Date().toISOString());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load live Activity data.');
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh(true);
    const timer = setInterval(() => void refresh(false), 15_000);
    return () => clearInterval(timer);
  }, [refresh]));

  const recentSignals = useMemo(() => snapshot?.observations.slice(0, 8) ?? [], [snapshot]);
  const updatedAt = lastRefreshedAt ?? snapshot?.generatedAt;

  return <Screen refreshing={loading && snapshot !== null} onRefresh={() => void refresh(true)}>
    <BrandHeader section="Privacy and data-value command center" />
    <MascotHero />

    <View style={s.stats}>
      <Metric label="APPS SEEN" value={snapshot?.metrics.attributedApps} />
      <Metric label="DOMAINS" value={snapshot?.metrics.distinctDomains} />
      <Metric label="REVIEW" value={snapshot?.metrics.review} warning />
    </View>

    <Card>
      <View style={ui.row}>
        <View style={s.flex}>
          <Text style={ui.eyebrow}>LIVE METADATA</Text>
          <Text style={ui.h2}>{snapshot?.consent.status === 'active' ? 'Permission linked.' : 'Permission needs attention.'}</Text>
        </View>
        <View style={[s.livePill, snapshot?.consent.status === 'active' && s.livePillActive]}>
          <View style={[s.liveDot, snapshot?.consent.status === 'active' && s.liveDotActive]} />
          <Text style={s.liveText}>{snapshot?.consent.status === 'active' ? 'CONSENT ACTIVE' : 'CHECK CONSENT'}</Text>
        </View>
      </View>
      <Text style={ui.body}>{snapshot?.consent.purpose ?? 'Checking the consent ledger before showing device observations.'}</Text>
      <Text style={[s.updated, error && s.updatedError]}>
        {loading ? 'Requesting the newest Engine snapshot…' : error ? 'Refresh failed · previous live data remains visible' : `Updated · ${formatTime(updatedAt)}`}
      </Text>
    </Card>

    <View style={ui.row}>
      <View style={s.flex}>
        <Text style={ui.eyebrow}>RECENT SIGNALS</Text>
        <Text style={ui.h2}>Who your apps contacted</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push('/engine')} hitSlop={8}>
        <Text style={ui.blue}>Engine →</Text>
      </Pressable>
    </View>

    {error && !snapshot && <Card>
      <Text style={ui.h2}>Live Activity is temporarily unavailable.</Text>
      <Text style={ui.body}>{error}</Text>
    </Card>}

    {!error && !loading && recentSignals.length === 0 && <Card>
      <Text style={ui.h2}>No minimized observations yet.</Text>
      <Text style={ui.body}>Turn monitoring on in Settings, then use the tablet normally. New app-to-company connections will appear here.</Text>
    </Card>}

    {recentSignals.map(item => <SignalCard key={`${item.observationId}:${item.destinationDomain}`} item={item} />)}

    <Text style={s.note}>Live, consent-linked destination metadata from this tablet. KICK'S does not inspect message, search, media, or payload contents. Technical evidence remains in Engine.</Text>
  </Screen>;
}

function Metric({ label, value, warning = false }: { label: string; value?: number; warning?: boolean }) {
  return <View style={s.metric}>
    <Text style={ui.label}>{label}</Text>
    <Text style={[s.stat, warning && ui.orange]}>{value == null ? '—' : value}</Text>
  </View>;
}

function SignalCard({ item }: { item: ActivityObservation }) {
  const app = item.sourceAppName ?? 'App identity pending';
  const company = item.company || item.destinationDomain || 'Company not yet identified';
  const tone = tierColors[item.behaviorTier] ?? tierColors.unknown;
  return <Card>
    <View style={s.signalHeader}>
      <View style={[s.appIcon, { borderColor: tone }]}><Text style={[s.appLetter, { color: tone }]}>{app.slice(0, 1).toUpperCase()}</Text></View>
      <View style={s.flex}>
        <Text style={s.app}>{app}</Text>
        <Text style={s.company}>→ {company}</Text>
      </View>
      <View style={[s.tier, { borderColor: tone }]}><Text style={[s.tierText, { color: tone }]}>{tierLabels[item.behaviorTier] ?? 'Investigate'}</Text></View>
    </View>
    <Text style={ui.body}>{item.plainLanguageSummary || `${app} contacted ${company} for ${item.purpose || 'a purpose still being reviewed'}.`}</Text>
    <View style={s.facts}>
      <Text style={s.fact}>{humanize(item.commercialFunction)} · {item.confidence}% confidence</Text>
      <Text style={s.fact}>{item.frequency} communication{item.frequency === 1 ? '' : 's'} · {formatTime(item.observedAt)}</Text>
    </View>
  </Card>;
}

function formatTime(value?: string | null) {
  if (!value) return 'Waiting for live data';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function humanize(value?: string | null) {
  if (!value) return 'Purpose under review';
  const text = value.replace(/_/g, ' ');
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderWidth: 1, borderColor: '#282329', borderRadius: 16, padding: 13, gap: 4 },
  stat: { color: colors.text, fontSize: 26, fontWeight: '900' }, flex: { flex: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: '#5e331d', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 },
  livePillActive: { borderColor: '#285d44', backgroundColor: '#0b2118' }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.orange }, liveDotActive: { backgroundColor: colors.green },
  liveText: { color: colors.text, fontSize: 8, fontWeight: '900', letterSpacing: .55 }, updated: { color: '#8f8179', fontSize: 10, fontWeight: '700' }, updatedError: { color: colors.red },
  signalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, appIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#140d08', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  appLetter: { fontWeight: '900' }, app: { color: colors.text, fontSize: 16, fontWeight: '800' }, company: { color: '#d5b59f', fontSize: 12, marginTop: 2 },
  tier: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5 }, tierText: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  facts: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: '#282329', paddingTop: 8 }, fact: { color: '#8f8179', fontSize: 9, lineHeight: 13, flex: 1 },
  note: { color: '#786961', fontSize: 11, lineHeight: 17 },
});
