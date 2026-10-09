import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { AccountButton } from '../components/AccountButton';
import { useSession } from '../components/SessionProvider';
import { SessionError } from '../services/sessionCore';

function httpsLink(value: string | undefined) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export default function Account() {
  const { manager, user, ready, restoreError, sessionWarning } = useSession();
  const [mode, setMode] = useState<'login' | 'create' | 'recovery'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const privacy = httpsLink(process.env.EXPO_PUBLIC_PRIVACY_URL);
  const terms = httpsLink(process.env.EXPO_PUBLIC_TERMS_URL);
  const recovery = httpsLink(process.env.EXPO_PUBLIC_DATASTORM_RECOVERY_URL);
  const termsVersion = process.env.EXPO_PUBLIC_TERMS_VERSION ?? '';
  const privacyVersion = process.env.EXPO_PUBLIC_PRIVACY_VERSION ?? '';
  const createReady = !!privacy && !!terms && !!termsVersion && !!privacyVersion;
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await action(); }
    catch (failure) { setMessage(failure instanceof SessionError ? failure.message : 'Account access is unavailable. Try again.'); }
    finally { setPassword(''); setBusy(false); }
  };
  const changeMode = (next: typeof mode) => { setMode(next); setPassword(''); setMessage(null); setAccepted(false); };
  const create = async () => {
    if (!createReady || !accepted) throw new SessionError('Review the published policies before creating an account.');
    // Preserve the retry key without retaining a second copy of the password.
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify({ email: email.trim(), password, termsVersion, privacyVersion }));
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: Crypto.randomUUID() };
    await manager.createAccount({ email, password, termsVersion, privacyVersion, idempotencyKey: attempt.current!.key });
    attempt.current = null; setMode('login'); setAccepted(false);
    setMessage('Your DataStorm account was created. Sign in to continue.');
  };
  return <Screen>
    <BrandHeader section="DataStorm account" />
    <Text style={ui.title}>Your account. Your choices.</Text>
    <Text style={ui.body}>One DataStorm Consumer Account connects you to KICK’S. Signing in does not authorize monitoring or data sharing.</Text>
    {!ready ? <ActivityIndicator color={colors.orange} /> : user ? <Card>
      <Text style={ui.h2}>Signed in</Text><Text style={ui.body}>{user.email}</Text>
      <AccountButton label="Open Profile" onPress={() => router.replace('/profile')} />
      <AccountButton label="Sign out" disabled={busy} onPress={() => void act(() => manager.logout())} />
    </Card> : <>
      <AccountButton label="Login" disabled={busy} onPress={() => changeMode('login')} />
      <AccountButton label="Create Account" disabled={busy} onPress={() => changeMode('create')} />
      <AccountButton label="Recovery" disabled={busy} onPress={() => changeMode('recovery')} />
      <Card>
        <Text style={ui.h2}>{mode === 'login' ? 'Sign in to DataStorm' : mode === 'create' ? 'Create your DataStorm account' : 'Recover account access'}</Text>
        {mode === 'recovery' ? <>
          <Text style={ui.body}>Account recovery is handled by DataStorm.</Text>
          <AccountButton label={recovery ? 'Open DataStorm recovery' : 'Recovery currently unavailable'} disabled={!recovery || busy} onPress={() => void act(() => Linking.openURL(recovery!))} />
        </> : <>
          <TextInput accessibilityLabel="Email" style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy} placeholder="Your email" placeholderTextColor={colors.muted} />
          <TextInput accessibilityLabel="Password" style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} editable={!busy} placeholder={mode === 'create' ? 'At least 12 characters' : 'Your password'} placeholderTextColor={colors.muted} />
          {mode === 'create' && <>
            <Text style={ui.body}>{createReady ? 'Review the Privacy Policy and Terms. Creating an account does not opt you into marketing or collection.' : 'Account creation is unavailable until the approved Privacy Policy and Terms are published.'}</Text>
            <AccountButton label="Privacy Policy" disabled={!privacy || busy} onPress={() => void act(() => Linking.openURL(privacy!))} />
            <AccountButton label="Terms" disabled={!terms || busy} onPress={() => void act(() => Linking.openURL(terms!))} />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted, disabled: !createReady || busy }} disabled={!createReady || busy} onPress={() => setAccepted(value => !value)}>
              <Text style={s.link}>{accepted ? '☑' : '☐'} I accept the Terms and acknowledge the Privacy Policy.</Text>
            </Pressable>
          </>}
          <AccountButton label={busy ? 'Please wait…' : mode === 'create' ? 'Create Account' : 'Sign in'} disabled={busy || !email.trim() || !password || (mode === 'create' && (!createReady || !accepted || password.length < 12))} onPress={() => void act(mode === 'create' ? create : async () => { await manager.login(email, password); router.replace('/profile'); })} />
        </>}
      </Card>
    </>}
    {(message || sessionWarning || (!user && restoreError)) && <Text accessibilityRole="alert" style={ui.body}>{message ?? sessionWarning ?? restoreError}</Text>}
    {sessionWarning?.startsWith('Secure storage') && <AccountButton label="Retry sign out" disabled={busy} onPress={() => void act(() => manager.logout())} />}
  </Screen>;
}
const s = StyleSheet.create({
  input: { color: colors.text, borderWidth: 1, borderColor: '#493a32', borderRadius: 10, padding: 12, fontSize: 16, marginVertical: 5 },
  link: { color: colors.orange, fontSize: 16, fontWeight: '700', paddingVertical: 12 }
});

