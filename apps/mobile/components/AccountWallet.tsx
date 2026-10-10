import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from './Brand';
import { useSession } from './SessionProvider';
import { loadConsumerProfile } from '../services/profileService';

export function AccountWallet() {
  const { manager, user, ready } = useSession();
  const [wallet, setWallet] = useState<any | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!manager.user || busy) return;
    setBusy(true); setUnavailable(false);
    try {
      const profile = await loadConsumerProfile(manager);
      setWallet(profile.wallet);
      setUnavailable(profile.unavailable.includes('wallet') || !profile.wallet);
    } catch {
      setWallet(null); setUnavailable(true);
    } finally { setBusy(false); }
  }, [manager, busy]);

  useEffect(() => { if (ready && user) void load(); }, [ready, user?.subjectId]);

  if (!ready) return <Screen><BrandHeader section="Rewards & wallet" /><ActivityIndicator color={colors.orange} /></Screen>;
  if (!user) return <Screen><BrandHeader section="Rewards & wallet" /><Card><Text style={ui.h2}>Connect your DataStorm account</Text><Text style={ui.body}>Sign in before viewing account-bound rewards.</Text><Pressable onPress={() => router.push('/account')}><Text style={ui.label}>SIGN IN</Text></Pressable></Card></Screen>;

  return <Screen>
    <BrandHeader section="Rewards & wallet" />
    <Text style={ui.title}>Your account-bound wallet.</Text>
    <Text style={ui.body}>KICK’S only shows wallet data returned for your authenticated DataStorm subject. Demo balances are never substituted for unavailable live data.</Text>
    {busy && <ActivityIndicator color={colors.orange} />}
    {wallet && !unavailable ? <Card accent>
      <Text style={ui.eyebrow}>LIVE WALLET</Text>
      <Text style={ui.h2}>${Number(wallet.total_earned ?? 0).toFixed(2)} earned</Text>
      <Text style={ui.body}>Pending: ${Number(wallet.total_pending ?? 0).toFixed(2)}</Text>
      <Text style={ui.body}>Settled: ${Number(wallet.total_settled ?? 0).toFixed(2)}</Text>
    </Card> : !busy && <Card>
      <Text style={ui.h2}>Wallet service unavailable</Text>
      <Text style={ui.body}>The account is connected, but the staging wallet endpoint is not yet exposed through the authenticated consumer boundary. No placeholder balance is shown.</Text>
    </Card>}
    <Pressable disabled={busy} onPress={load}><Text style={ui.label}>REFRESH WALLET</Text></Pressable>
    <Pressable onPress={() => router.push('/profile')}><Text style={ui.label}>BACK TO PROFILE</Text></Pressable>
  </Screen>;
}
