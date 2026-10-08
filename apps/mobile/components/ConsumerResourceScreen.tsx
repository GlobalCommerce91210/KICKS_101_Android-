import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text } from 'react-native';
import { BrandHeader, Card, Screen, ui } from './Brand';
import { AccountButton } from './AccountButton';
import { useAccountSession } from './AccountSession';
import { accountApi, type Resource } from '../services/accountApi';

/** Authenticated views never read the legacy user_demo_01 permission or wallet stores. */
export function ConsumerResourceScreen({ kind }: { kind: 'snapshot' | 'permissions' | 'wallet' }) {
  const { session } = useAccountSession();
  const [data, setData] = useState<Resource | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true), [revision, setRevision] = useState(0), [control, setControl] = useState<string | null>(null);
  const consumerId = session?.account.consumer_id;
  useEffect(() => {
    let current = true; setBusy(true); setData(null); setError(null); setControl(null);
    if (!consumerId) return () => { current = false; };
    const path = kind === 'snapshot' ? '/core/consumer/v1/snapshot' : `/v1/me/${kind}`;
    void Promise.all([
      accountApi.resource(path).then(result => { if (result.consumer_id !== consumerId) throw new Error(); if (current) setData(result); }),
      kind === 'permissions' ? accountApi.controls().then(result => { if (current && result.consumer_id === consumerId) setControl(result.controls.consent || null); }).catch(() => {}) : Promise.resolve()
    ]).catch(() => { if (current) setError('This account view is currently unavailable. Please retry.'); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [consumerId, kind, revision]);
  const value = (key: string) => typeof data?.[key] === 'string' || typeof data?.[key] === 'number' ? String(data[key]) : 'Unavailable';
  const openConsent = async () => { try { const url = new URL(control || ''); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); await Linking.openURL(url.href); } catch { setError('Consent center could not be opened. Please retry later.'); } };
  return <Screen>
    <BrandHeader section={kind === 'snapshot' ? 'Your consumer dashboard' : kind === 'permissions' ? 'Permissions & consent' : 'Your wallet'} />
    <Text style={ui.title}>{kind === 'snapshot' ? `Welcome, ${session?.account.display_name || 'consumer'}` : kind === 'permissions' ? 'Your data. Your choices.' : 'Your DataStorm wallet'}</Text>
    {busy ? <ActivityIndicator accessibilityLabel="Loading account view" /> : error ? <Text accessibilityLiveRegion="polite" style={ui.body}>{error}</Text> : <Card>
      {kind === 'snapshot' ? <Text style={ui.body}>Membership: {value('membership_status')}</Text> : kind === 'permissions' ? <><Text style={ui.body}>Active permissions: {value('active_count')}</Text><Text style={ui.body}>Revoked permissions: {value('revoked_count')}</Text><Text style={ui.body}>Grant or revoke purpose-specific consent in the DataStorm consent center. Closing your account is a separate action.</Text></> : <><Text style={ui.body}>Currency: {value('currency')}</Text><Text style={ui.body}>Available: {value('available_balance')}</Text><Text style={ui.body}>Pending: {value('pending_balance')}</Text><Text style={ui.body}>Payout actions require the canonical DataStorm wallet service. Demo earnings are not included in your account.</Text></>}
    </Card>}
    {kind === 'permissions' ? <AccountButton label={control ? 'Open DataStorm consent center' : 'Consent center · unavailable'} disabled={!control} onPress={() => void openConsent()} /> : null}
    <AccountButton label="Refresh" disabled={busy} onPress={() => setRevision(v => v + 1)} />
  </Screen>;
}
