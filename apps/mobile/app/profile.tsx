import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, ui } from '../components/Brand';
import { AccountButton } from '../components/AccountButton';
import { useSession } from '../components/SessionProvider';
import { loadCanonicalProfile, type CanonicalProfile, type JsonRecord } from '../services/canonicalProfile';
function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function value(input: unknown) { return typeof input === 'string' || typeof input === 'number' ? String(input) : 'Unavailable'; }
function amount(input: unknown, currency: unknown) { return typeof input === 'number' && Number.isSafeInteger(input) && typeof currency === 'string' ? currency + ' ' + (input / 100).toFixed(2) : 'Unavailable'; }
export default function Profile() {
  const { manager, user, ready, sessionWarning } = useSession();
  const [data, setData] = useState<CanonicalProfile | null>(null);
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setData(null); setMessage(null);
    if (!ready || !user) { setBusy(false); return () => { live = false; }; }
    setBusy(true);
    void loadCanonicalProfile(manager, user.subjectId).then(result => { if (live) setData(result); })
      .catch(() => { if (live) setMessage('Your profile could not be loaded. Please retry.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [manager, user?.subjectId, ready, revision]);
  if (!ready) return <Screen><ActivityIndicator accessibilityLabel="Checking your session" /></Screen>;
  if (!user) return <Screen><Text style={ui.title}>Sign in to view your profile.</Text><AccountButton label="Open Login" onPress={() => router.replace('/account')} /></Screen>;
  const account = record(data?.profile.data?.account), entitlement = record(data?.profile.data?.entitlement);
  const snapshot = data?.snapshot.data ?? {}, consumer = record(snapshot.consumer);
  const monitoring = record(snapshot.monitoring), permissions = record(snapshot.permissions), wallet = record(snapshot.wallet);
  const devices = Array.isArray(data?.devices.data?.devices) ? data!.devices.data!.devices as JsonRecord[] : [];
  return <Screen>
    <BrandHeader section="Your DataStorm consumer profile" />
    <Text style={ui.title}>Your profile</Text>
    <Card accent><Text style={ui.h2}>DataStorm Consumer Account</Text><Text style={ui.body}>{user.email}</Text><Text selectable style={ui.body}>Account ID: {user.subjectId}</Text><Text style={ui.body}>Account status: {value(account.account_status)}</Text><Text style={ui.body}>Email verified: {typeof account.email_verified === 'boolean' ? account.email_verified ? 'Yes' : 'Pending' : 'Unavailable'}</Text>{data?.profile.error && <Text style={ui.body}>{data.profile.error}</Text>}</Card>
    {busy && <ActivityIndicator accessibilityLabel="Loading your profile" />}
    <Card><Text style={ui.h2}>KICK’S membership</Text><Text style={ui.body}>Access: {value(entitlement.status)}</Text><Text style={ui.body}>Profile: {value(consumer.profile_id)}</Text><Text style={ui.body}>Snapshot: {value(snapshot.snapshot_status)}</Text>{data?.snapshot.error && <Text style={ui.body}>{data.snapshot.error}</Text>}</Card>
    <Card><Text style={ui.h2}>Connected devices</Text><Text style={ui.body}>{data?.devices.error ?? (data?.devices.data ? devices.length ? devices.map(device => value(device.display_name ?? device.device_id) + ' · ' + value(device.monitoring_status)).join('\n') : 'No connected devices.' : 'Currently unavailable.')}</Text></Card>
    <Card><Text style={ui.h2}>Permissions & consent</Text><Text style={ui.body}>Permission summary — active: {value(permissions.active)} · revoked: {value(permissions.revoked)}</Text><Text style={ui.body}>Monitoring consent is reviewed separately for each device and purpose.</Text><AccountButton label="Review device consent" onPress={() => router.push('/permissions')} /></Card>
    <Card><Text style={ui.h2}>Monitoring</Text><Text style={ui.body}>Status: {value(monitoring.status)}</Text><Text style={ui.body}>Source: {value(monitoring.source_status)}</Text><Text style={ui.body}>Last observation: {value(monitoring.as_of)}</Text></Card>
    <Card><Text style={ui.h2}>Wallet summary</Text><Text style={ui.body}>Available: {wallet.source_status === 'available' ? amount(wallet.available_minor, wallet.currency) : 'Unavailable'}</Text><Text style={ui.body}>Pending: {wallet.source_status === 'available' ? amount(wallet.pending_minor, wallet.currency) : 'Unavailable'}</Text><Text style={ui.body}>Source: {value(wallet.source_status)}</Text><Text style={ui.body}>Staging balances do not establish payout availability.</Text></Card>
    <AccountButton label="Refresh Profile" disabled={busy} onPress={() => setRevision(number => number + 1)} />
    <Text style={ui.body}>Your human account and collector device identities remain separate. Revoking consent does not require closing your account.</Text>
    <AccountButton label="App preferences" onPress={() => router.push('/settings')} />
    {(message || sessionWarning) && <Text accessibilityRole="alert" style={ui.body}>{message ?? sessionWarning}</Text>}
    <AccountButton label="Sign out" onPress={() => { void manager.logout().catch(() => setMessage('Signed out locally. Server revocation or secure storage cleanup could not be confirmed.')); }} />
  </Screen>;
}
