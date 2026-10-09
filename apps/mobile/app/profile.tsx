import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { useSession } from '../components/SessionProvider';
import { loadConsumerProfile, type ConsumerProfileView } from '../services/profileService';

function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
  return null;
}
function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}
function statusText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.replaceAll('_', ' ') : 'Unavailable';
}

export default function Profile() {
  return Platform.OS === 'ios' ? <IosProfile /> : (
    <Screen><BrandHeader section="Consumer profile" /><Text style={ui.body}>Profile hydration is currently staged for the iOS operational beta. Android remains unchanged.</Text></Screen>
  );
}

function IosProfile() {
  const { manager, user, ready } = useSession();
  const [profile, setProfile] = useState<ConsumerProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!manager.user) return;
    setLoading(true); setError(null);
    try { setProfile(await loadConsumerProfile(manager)); }
    catch (failure) {
      if (!manager.user) return;
      setError(failure instanceof Error ? failure.message : 'Profile is unavailable. Try again.');
    } finally { setLoading(false); }
  }, [manager]);

  useEffect(() => {
    if (ready && !user) router.replace('/account');
  }, [ready, user]);

  useFocusEffect(useCallback(() => {
    if (ready && user) void refresh();
    return () => {};
  }, [ready, user, refresh]));

  if (!ready || (loading && !profile)) {
    return <Screen><BrandHeader section="Consumer profile" /><Card><ActivityIndicator color={colors.orange} /><Text style={ui.body}>Loading your DataStorm account…</Text></Card></Screen>;
  }
  if (!user) return null;

  const activePermissions = profile?.permissions ? countOf((profile.permissions as any).apps) : null;
  const revoked = typeof (profile?.snapshot as any)?.permissions?.revoked === 'number' ? (profile?.snapshot as any).permissions.revoked : null;
  const wallet = profile?.wallet as any;
  const monitoring = profile?.monitoring as any;

  return <Screen>
    <BrandHeader section="DataStorm consumer profile" />
    <Text style={ui.title}>One account. One identity spine.</Text>
    <Text style={ui.body}>KICK’S uses your verified DataStorm consumer identity. Devices and collector identities remain separate and can be revoked independently.</Text>

    {error && <Card><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable onPress={refresh}><Text style={s.link}>Try again</Text></Pressable></Card>}

    <Card accent>
      <Text style={ui.eyebrow}>ACCOUNT IDENTITY</Text>
      <Text style={ui.h2}>{profile?.account.displayName ?? profile?.account.email ?? user.email}</Text>
      <Text style={ui.body}>{profile?.account.email ?? user.email}</Text>
      <Row label="Account status" value={statusText(profile?.account.status)} />
      <Row label="KICK’S profile" value={statusText(profile?.product.status)} />
      <Text style={s.subject}>DataStorm subject: {user.subjectId}</Text>
    </Card>

    <Card>
      <Text style={ui.eyebrow}>MONITORING</Text>
      <Row label="Status" value={statusText(monitoring?.status)} />
      <Row label="Apps observed" value={monitoring?.apps_observed ?? '—'} />
      <Row label="Destinations / 24h" value={monitoring?.destinations_observed_24h ?? '—'} />
      <Row label="Items needing review" value={monitoring?.items_needing_review ?? '—'} />
    </Card>

    <Card>
      <Text style={ui.eyebrow}>DEVICES</Text>
      <Row label="Connected devices" value={profile?.devices.length ?? 0} />
      <Text style={ui.body}>Device and collector IDs are operational identities. They do not replace your DataStorm consumer account.</Text>
      {profile?.devices.slice(0, 4).map((device: any, index) =>
        <View key={String(device.device_id ?? device.id ?? index)} style={s.device}>
          <Text style={s.deviceTitle}>{device.name ?? device.device_name ?? `Device ${index + 1}`}</Text>
          <Text style={ui.body}>Collector: {statusText(device.collector_status)} · Monitoring: {statusText(device.monitoring_status)}</Text>
        </View>
      )}
    </Card>

    <Card>
      <Text style={ui.eyebrow}>PERMISSIONS & CONSENT</Text>
      <Row label="Permission records" value={activePermissions ?? '—'} />
      <Row label="Revoked" value={revoked ?? '—'} />
      <Row label="Recent consent events" value={profile?.consentLog.length ?? 0} />
      <Pressable onPress={() => router.push('/permissions')}><Text style={s.link}>Review permissions</Text></Pressable>
    </Card>

    <Card>
      <Text style={ui.eyebrow}>WALLET</Text>
      <Row label="Total earned" value={numberText(wallet?.total_earned)} />
      <Row label="Pending" value={numberText(wallet?.total_pending)} />
      <Row label="Settled" value={numberText(wallet?.total_settled)} />
      <Pressable onPress={() => router.push('/wallet')}><Text style={s.link}>Open wallet</Text></Pressable>
    </Card>

    {!!profile?.unavailable.length && <Card>
      <Text style={ui.eyebrow}>STAGING AVAILABILITY</Text>
      <Text style={ui.body}>Some profile sources are not available from the current staging API: {profile.unavailable.join(', ')}. No placeholder data is being presented as live.</Text>
    </Card>}

    <Pressable disabled={loading} onPress={refresh}><Text style={s.link}>{loading ? 'Refreshing…' : 'Refresh profile'}</Text></Pressable>
    <Pressable onPress={() => router.push('/settings')}><Text style={s.secondary}>Account & privacy settings</Text></Pressable>
  </Screen>;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return <View style={s.row}><Text style={ui.body}>{label}</Text><Text style={s.value}>{String(value)}</Text></View>;
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  value: { color: colors.text, fontWeight: '800', textTransform: 'capitalize' },
  link: { color: colors.orange, fontSize: 15, fontWeight: '800', paddingVertical: 10 },
  secondary: { color: colors.blue, fontSize: 14, fontWeight: '700', paddingVertical: 10 },
  subject: { color: '#786961', fontSize: 10, marginTop: 4 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  device: { borderTopWidth: 1, borderTopColor: '#282329', paddingTop: 10, marginTop: 4 },
  deviceTitle: { color: colors.text, fontWeight: '800' }
});
