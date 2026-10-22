import { visibleCache, type RequestState } from '../services/requestState.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from './Brand';
import { useSession } from './SessionProvider';
import { loadConsumerProfile } from '../services/profileService';

export function AccountWallet() {
  const { manager, user } = useSession();
  return <AccountWalletBody key={`${user?.subjectId ?? 'signed-out'}:${manager.sessionGeneration}`} />;
}
function AccountWalletBody() {
  const { manager, user, ready } = useSession();
  const [saved, setSaved] = useState<{ account: object; wallet: any; at: number } | null>(null);
  const flight = useRef(false);
  const wallet = visibleCache(saved ? { account: saved.account, data: saved.wallet, at: saved.at } : null, user);
  const [state, setState] = useState<RequestState>('IDLE');
  const [message, setMessage] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!manager.user || flight.current) return;
    const account = manager.user; flight.current = true;
    setBusy(true); setState('LOADING'); setUnavailable(false);
    try {
      const profile = await loadConsumerProfile(manager);
      if (manager.user !== account) return;
      if (profile.wallet) setSaved({ account, wallet: profile.wallet, at: Date.now() });
      setUnavailable(profile.unavailable.includes('wallet') || !profile.wallet);
      setState(profile.sources.wallet?.state ?? 'UNAVAILABLE');
      setMessage(profile.sources.wallet?.message ?? '');
    } catch {
      setMessage('Wallet could not be verified. Refresh to retry.');
      if (manager.user === account) { setUnavailable(true); setState('UNAVAILABLE'); }
    } finally { flight.current = false; setBusy(false); }
  }, [manager]);

  useEffect(() => { if (ready && user) void load(); }, [ready, user?.subjectId]);

  if (!ready) return <Screen><BrandHeader section="Rewards & wallet" /><ActivityIndicator color={colors.orange} /></Screen>;
  if (!user) return <Screen><BrandHeader section="Rewards & wallet" /><Card><Text style={ui.h2}>Connect your DataStorm account</Text><Text style={ui.body}>Sign in before viewing account-bound rewards.</Text><Pressable onPress={() => router.push('/account')}><Text style={ui.label}>SIGN IN</Text></Pressable></Card></Screen>;

  return <Screen>
    <BrandHeader section="Rewards & wallet" />
    <Text style={ui.title}>Your account-bound wallet.</Text>
    <Text style={ui.body}>KICK’S only shows wallet data returned for your authenticated DataStorm subject. Demo balances are never substituted for unavailable live data.</Text>
    <Text style={ui.label}>{state}</Text>
    {message && <Text accessibilityRole="alert" style={ui.body}>{message}</Text>}
    {busy && <ActivityIndicator color={colors.orange} />}
    {wallet ? <Card accent>
      <Text style={ui.eyebrow}>{unavailable || busy ? 'STALE WALLET · previously loaded' : 'WALLET'}</Text>
      <Text style={ui.h2}>${Number(wallet.total_earned).toFixed(2)} earned</Text>
      <Text style={ui.body}>Pending: ${Number(wallet.total_pending).toFixed(2)}</Text>
      <Text style={ui.body}>Settled: ${Number(wallet.total_settled).toFixed(2)}</Text>
    </Card> : !busy && <Card>
      <Text style={ui.h2}>Wallet service unavailable</Text>
      <Text style={ui.body}>Wallet data could not be verified. Check your connection and refresh. No balance is inferred from a failed request.</Text>
    </Card>}
    <Pressable disabled={busy} onPress={load}><Text style={ui.label}>REFRESH WALLET</Text></Pressable>
    <Pressable onPress={() => router.push('/profile')}><Text style={ui.label}>BACK TO PROFILE</Text></Pressable>
  </Screen>;
}
