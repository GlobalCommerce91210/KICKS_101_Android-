import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { useSession } from '../components/SessionProvider';
import { SessionError } from '../services/sessionCore';

export default function Account() {
  return <ConsumerAccount />;
}
function ConsumerAccount() {
  const { manager, user, ready, restoreError, sessionWarning } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const termsVersion = process.env.EXPO_PUBLIC_TERMS_VERSION ?? '';
  const privacyVersion = process.env.EXPO_PUBLIC_PRIVACY_VERSION ?? '';
  const [error, setError] = useState<string | null>(null);
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); }
    catch (failure) { setError(failure instanceof SessionError ? failure.message : 'Account access is unavailable. Try again.'); }
    finally { setPassword(''); setBusy(false); }
  };
  return <Screen>
    <BrandHeader section="DataStorm account" />
    <Text style={ui.title}>Your account. Your choices.</Text>
    <Text style={ui.body}>Use your existing DataStorm account to access KICK’S. Signing in does not authorize monitoring or data sharing.</Text>
    {!ready ? <Card><ActivityIndicator color={colors.orange} /><Text style={ui.body}>Checking your session…</Text></Card> : user ? <Card>
      <Text style={ui.h2}>Signed in</Text><Text style={ui.body}>{user.email}</Text>
      <Pressable disabled={busy} onPress={() => router.replace('/profile')}><Text style={s.link}>Open my profile</Text></Pressable>
      <Pressable disabled={busy} onPress={() => router.push('/permissions')}><Text style={s.link}>Review permissions</Text></Pressable>
      <Pressable disabled={busy} onPress={() => act(() => manager.logout())}><Text style={s.link}>Sign out</Text></Pressable>
    </Card> : <Card>
      <Text style={ui.h2}>{mode === 'create' ? 'Create your DataStorm account' : 'Sign in to DataStorm'}</Text>
      <Text style={ui.label}>EMAIL</Text>
      <TextInput accessibilityLabel="Email" style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy} placeholder="Your email" placeholderTextColor={colors.muted} />
      <Text style={ui.label}>PASSWORD</Text>
      <TextInput accessibilityLabel="Password" style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" editable={!busy} placeholder="Your password" placeholderTextColor={colors.muted} />
      {mode === 'create' && <>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: legalAccepted }} disabled={busy}
          onPress={() => setLegalAccepted(value => !value)}>
          <Text style={s.link}>{legalAccepted ? '☑' : '☐'} I agree to the DataStorm Terms and Privacy Notice.</Text>
        </Pressable>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: marketingOptIn }} disabled={busy}
          onPress={() => setMarketingOptIn(value => !value)}>
          <Text style={s.link}>{marketingOptIn ? '☑' : '☐'} Send me optional DataStorm product updates.</Text>
        </Pressable>
      </>}
      <Pressable accessibilityRole="button"
        disabled={busy || !email.trim() || !password || (mode === 'create' && (!legalAccepted || password.length < 12 || !termsVersion || !privacyVersion))}
        onPress={() => act(() => (mode === 'create'
          ? manager.register(email, password, { termsVersion, privacyVersion, marketingOptIn })
          : manager.login(email, password)).then(() => { router.replace('/profile'); }))}>
        <Text style={s.link}>{busy ? (mode === 'create' ? 'Creating account…' : 'Signing in…') : (mode === 'create' ? 'Create account' : 'Sign in')}</Text>
      </Pressable>
      {mode === 'create' && (!termsVersion || !privacyVersion) &&
        <Text accessibilityRole="alert" style={ui.body}>Account registration is disabled until this build is configured with the current Terms and Privacy versions.</Text>}
      <Pressable disabled={busy} onPress={() => { setMode(mode === 'create' ? 'signin' : 'create'); setError(null); }}>
        <Text style={s.link}>{mode === 'create' ? 'Already have an account? Sign in' : 'New to DataStorm? Create an account'}</Text>
      </Pressable>
      <Text style={ui.body}>Signing in or creating an account does not authorize monitoring or data sharing.</Text>
    </Card>}
    {(error || sessionWarning || (!user && restoreError)) && <Card>
      <Text accessibilityRole="alert" style={ui.body}>{error ?? sessionWarning ?? restoreError}</Text>
      {sessionWarning?.startsWith('Secure storage') && <Pressable accessibilityRole="button" disabled={busy} onPress={() => act(() => manager.logout())}><Text style={s.link}>Retry sign out</Text></Pressable>}
    </Card>}
    {busy && <View><ActivityIndicator color={colors.orange} /></View>}
    <Pressable onPress={() => router.push('/settings')}><Text style={s.link}>Back to Settings</Text></Pressable>
  </Screen>;
}
const s = StyleSheet.create({
  input: { color: colors.text, borderWidth: 1, borderColor: '#493a32', borderRadius: 10, padding: 12, fontSize: 16 },
  link: { color: colors.orange, fontSize: 16, fontWeight: '700', paddingVertical: 12 }
});
