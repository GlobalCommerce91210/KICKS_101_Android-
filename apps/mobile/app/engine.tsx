import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { collectorApi, CollectorStatus } from '../services/collectorApi';

const demoSignals = [
  ['Transit Map', 'api.mapbox.com', 'Location', 'Expected'],
  ['Shop Sample', 'events.analytics.example', 'Device ID · Usage', 'Review'],
  ['Weather Sample', 'api.weather.example', 'Approx. location', 'Expected'],
  ['News Sample', 'ads.measure.example', 'Ad ID · Session', 'Review']
];

export default function Engine() {
  const [status, setStatus] = useState<CollectorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await collectorApi.getStatus();
    setStatus(next);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const requestVpn = async () => {
    setMessage('');
    try {
      const result = await collectorApi.requestAuthorization();
      setMessage(result === 'authorized'
        ? 'Android VPN permission is authorized. Collector verification is still required.'
        : 'Complete the Android VPN permission prompt, then refresh status.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'VPN authorization is unavailable.');
    }
    await refresh();
  };

  const startCollector = async () => {
    setMessage('');
    try {
      await collectorApi.start();
      setMessage('Start requested. Do not treat monitoring as active until native and backend verification succeeds.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Collector could not start.');
    }
    await refresh();
  };

  const state = status?.state ?? 'UNAVAILABLE';
  const verified = state === 'VERIFIED' && status?.verification === 'verified';
  const canStart = Boolean(status?.collectorEnabled && status.vpnAuthorized && status.notificationPermissionGranted && verified);

  return (
    <Screen>
      <BrandHeader section="Exfiltration Engine" logoTheme="demo" />
      <Card accent>
        <Text style={ui.eyebrow}>COLLECTOR STATUS</Text>
        <Text style={ui.title}>Privacy monitoring</Text>
        <View style={s.statusRow}>
          <View style={[s.dot, verified ? s.dotVerified : s.dotOff]} />
          <Text style={s.state}>{loading ? 'Checking status…' : state.replaceAll('_', ' ')}</Text>
          {loading ? <ActivityIndicator size="small" color={colors.orange} /> : null}
        </View>
        <Text style={ui.body}>
          {verified
            ? 'Native collector and backend verification report ready.'
            : 'Monitoring is OFF. This build does not have a verified native forwarding and ingestion path. The activity below is demonstration data only.'}
        </Text>
        <Text style={s.disclosure}>MONITORING OFF BY DEFAULT · DEMO DATA IS NOT LIVE TRAFFIC</Text>
        <View style={s.actions}>
          <Pressable onPress={requestVpn} disabled={loading || !status?.collectorEnabled} style={[s.button, (loading || !status?.collectorEnabled) && s.buttonDisabled]}>
            <Text style={[s.buttonText, (loading || !status?.collectorEnabled) && s.buttonTextDisabled]}>
              {status?.collectorEnabled ? 'Check / authorize VPN' : 'VPN authorization unavailable'}
            </Text>
          </Pressable>
          <Pressable onPress={startCollector} disabled={!canStart} style={[s.button, !canStart && s.buttonDisabled]}>
            <Text style={[s.buttonText, !canStart && s.buttonTextDisabled]}>Start verified collector</Text>
          </Pressable>
          <Pressable onPress={() => void refresh()} style={s.refresh}>
            <Text style={s.refreshText}>Refresh status</Text>
          </Pressable>
        </View>
        {message ? <Text accessibilityRole="alert" style={s.message}>{message}</Text> : null}
        {status ? (
          <View style={s.checks}>
            <Check label="Android VPN authorization" ok={status.vpnAuthorized} />
            <Check label="Notification permission" ok={status.notificationPermissionGranted} />
            <Check label="Native collector enabled in build" ok={status.collectorEnabled} />
            <Check label="End-to-end verification" ok={verified} />
          </View>
        ) : null}
      </Card>

      <View style={s.metrics}>
        <Metric label="APPS" value="DEMO" />
        <Metric label="DOMAINS" value="DEMO" />
        <Metric label="BROKERS" value="DEMO" />
        <Metric label="VALUE SIGNAL" value="—" />
      </View>
      <View>
        <Text style={ui.eyebrow}>SAMPLE TRAFFIC FEED</Text>
        <Text style={ui.h2}>Illustrative destinations</Text>
      </View>
      {demoSignals.map(([app, domain, data, label]) => (
        <Card key={domain}>
          <View style={ui.row}>
            <Text style={s.app}>{app}</Text>
            <Text style={label === 'Review' ? s.review : s.expected}>{label}</Text>
          </View>
          <Text style={s.domain}>{domain}</Text>
          <View style={ui.row}>
            <Text style={ui.body}>{data}</Text>
            <Text style={s.time}>SAMPLE</Text>
          </View>
        </Card>
      ))}
      <Card>
        <Text style={ui.eyebrow}>DATA BOUNDARY</Text>
        <Text style={ui.h2}>Metadata only</Text>
        <Text style={ui.body}>
          A production release must collect only approved network metadata, verify the enrolled device and current purpose-specific consent with the backend, and stop immediately when consent or OS authorization is lost. No payload bodies, messages, credentials, or browsing content are permitted.
        </Text>
      </Card>
    </Screen>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={s.checkRow}>
      <View style={[s.checkDot, ok ? s.dotVerified : s.dotOff]} />
      <Text style={s.checkLabel}>{label}</Text>
      <Text style={ok ? s.ok : s.notOk}>{ok ? 'READY' : 'NOT READY'}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metric}>
      <Text style={ui.label}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotVerified: { backgroundColor: '#39c779' },
  dotOff: { backgroundColor: colors.orange },
  state: { color: colors.text, fontSize: 13, fontWeight: '900', flex: 1 },
  disclosure: { color: colors.orange, fontSize: 10, fontWeight: '900', letterSpacing: 0.5, marginTop: 6 },
  actions: { gap: 8, marginTop: 14 },
  button: { borderRadius: 12, borderWidth: 1, borderColor: colors.orange, padding: 12, alignItems: 'center' },
  buttonDisabled: { borderColor: '#4a4240', backgroundColor: '#211d1d' },
  buttonText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  buttonTextDisabled: { color: '#8b807c' },
  refresh: { alignItems: 'center', padding: 8 },
  refreshText: { color: colors.blue, fontWeight: '800', fontSize: 12 },
  message: { color: colors.text, fontSize: 12, marginTop: 8 },
  checks: { gap: 8, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#342b2a' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkDot: { width: 7, height: 7, borderRadius: 4 },
  checkLabel: { color: colors.muted, fontSize: 11, flex: 1 },
  ok: { color: '#39c779', fontSize: 9, fontWeight: '900' },
  notOk: { color: colors.orange, fontSize: 9, fontWeight: '900' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '48%', backgroundColor: colors.panel, borderWidth: 1, borderColor: '#2b2527', borderRadius: 16, padding: 15 },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 5 },
  app: { color: colors.text, fontSize: 16, fontWeight: '800' },
  domain: { color: colors.blue, fontFamily: 'monospace', fontSize: 13 },
  review: { color: colors.orange, fontWeight: '800' },
  expected: { color: '#39c779', fontWeight: '800' },
  time: { color: '#776a63', fontSize: 10, fontWeight: '800' }
});
