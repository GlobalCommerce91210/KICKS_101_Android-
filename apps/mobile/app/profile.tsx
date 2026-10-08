import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, ui } from '../components/Brand';
import { AccountButton } from '../components/AccountButton';
import { useAccountSession } from '../components/AccountSession';
import { accountApi } from '../services/accountApi';
import { hydrateProfile, type ProfileData, type ProfileKey } from '../services/profileData';

const labels: Record<ProfileKey, string> = { state: 'Consumer account', snapshot: 'KICK’S membership', devices: 'Connected devices', permissions: 'Permissions', consent: 'Consent history', monitoring: 'Monitoring', wallet: 'Wallet summary' };
const controls: Record<string, string> = { security: 'Account security & sessions', devices: 'Manage devices', export: 'Export my data', close: 'Request account closure', privacy: 'Privacy policy', terms: 'Terms' };
function text(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Unavailable'; }
function summary(key: ProfileKey, data: Record<string, unknown>) {
  if (key === 'state') return `Profile status: ${text(data.profile_status)}`;
  if (key === 'snapshot') return `Membership: ${text(data.membership_status)}`;
  if (key === 'devices') {
    const devices = Array.isArray(data.devices) ? data.devices as Record<string, unknown>[] : [];
    return devices.length ? devices.map(d => `${text(d.label)} · ${text(d.status)}`).join('\n') : 'No connected devices.';
  }
  if (key === 'permissions' || key === 'consent') return `Active: ${text(data.active_count)} · Revoked: ${text(data.revoked_count)}`;
  if (key === 'monitoring') return `Status: ${text(data.status)}`;
  return `${text(data.currency)} · Available: ${text(data.available_balance)} · Pending: ${text(data.pending_balance)}`;
}
export default function Profile() {
  const { session, logout } = useAccountSession();
  const [data, setData] = useState<ProfileData>({}), [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true), [revision, setRevision] = useState(0), [message, setMessage] = useState<string | null>(null);
  const consumerId = session?.account.consumer_id;
  useEffect(() => {
    let current = true;
    setData({}); setLinks({}); setBusy(true);
    if (!consumerId) return () => { current = false; };
    void Promise.all([
      hydrateProfile(consumerId).then(result => { if (current) setData(result); }),
      accountApi.controls().then(result => { if (current && result.consumer_id === consumerId) setLinks(result.controls); }).catch(() => { if (current) setMessage('Some account controls are currently unavailable.'); })
    ]).catch(() => { if (current) setMessage('Your session could not be verified. Please log in again.'); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [consumerId, revision]);
  const open = async (key: string) => {
    try { const url = new URL(links[key] ?? ''); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); await Linking.openURL(url.href); }
    catch { setMessage('This account control could not be opened. Please retry later.'); }
  };
  return <Screen>
    <BrandHeader section="Your DataStorm consumer profile" />
    <Text style={ui.title}>{session?.account.display_name || 'Your profile'}</Text>
    <Card accent><Text style={ui.h2}>DataStorm Consumer Account</Text><Text style={ui.body}>{session?.account.email || 'Contact identity not available'}</Text><Text selectable style={ui.body}>Consumer ID: {consumerId}</Text><Text style={ui.body}>Account status: {session?.account.account_status}</Text></Card>
    {busy ? <ActivityIndicator accessibilityLabel="Loading your profile" /> : (Object.keys(labels) as ProfileKey[]).map(key => <Card key={key}><Text style={ui.h2}>{labels[key]}</Text><Text style={ui.body}>{data[key]?.data ? summary(key, data[key]!.data!) : data[key]?.error || 'Currently unavailable. Please retry.'}</Text></Card>)}
    <AccountButton label="Refresh profile" disabled={busy} onPress={() => { setMessage(null); setRevision(v => v + 1); }} />
    <Text style={ui.eyebrow}>PRIVACY & ACCOUNT CONTROLS</Text>
    <Text style={ui.body}>Each device is separate from your account. Revoking consent does not require closing your account.</Text>
    <AccountButton label="Permissions & consent" onPress={() => router.push('/permissions')} />
    {Object.entries(controls).map(([key, label]) => <AccountButton key={key} label={links[key] ? label : `${label} · unavailable`} disabled={!links[key]} onPress={() => void open(key)} />)}
    <AccountButton label="App preferences" onPress={() => router.push('/settings')} />
    {message ? <Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text> : null}
    <AccountButton label="Sign out" onPress={() => void logout()} />
  </Screen>;
}
