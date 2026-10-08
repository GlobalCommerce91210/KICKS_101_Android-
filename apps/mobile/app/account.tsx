import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { AccountButton } from '../components/AccountButton';
import { useAccountSession } from '../components/AccountSession';
import { accountApi, AccountError } from '../services/accountApi';

const destinations = ['/', '/profile', '/permissions', '/wallet', '/opportunities'];
export default function AccountLanding() {
  const { status, error, returnTo, login, restore } = useAccountSession();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [mode, setMode] = useState<'login' | 'create' | 'recovery'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (status === 'authenticated') router.replace(destinations.includes(next ?? '') ? next as '/' : returnTo as '/'); }, [status, next, returnTo]);
  const submit = async () => {
    setBusy(true); setMessage(null);
    try {
      if (mode === 'recovery') { await accountApi.recover(email.trim()); setMessage('If this address is eligible, DataStorm will send recovery instructions.'); }
      else await login(mode, email.trim(), password);
    } catch (e) {
      setMessage(e instanceof AccountError && e.status === 401 ? 'Your session or credentials could not be verified. Please log in again.' : e instanceof AccountError && e.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : 'DataStorm account access is currently unavailable. Your account has not been changed. Please retry later.');
    } finally { setPassword(''); setBusy(false); }
  };
  const policy = (name: 'privacy' | 'terms') => {
    const value = name === 'privacy' ? process.env.EXPO_PUBLIC_PRIVACY_URL : process.env.EXPO_PUBLIC_TERMS_URL;
    try { const url = new URL(value ?? ''); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); void Linking.openURL(url.href).catch(() => setMessage('This document could not be opened.')); }
    catch { setMessage(`${name === 'privacy' ? 'Privacy policy' : 'Terms'} publication is pending. Please check back before creating an account.`); }
  };
  return <Screen>
    <BrandHeader section="DataStorm Consumer Account" />
    <Text style={ui.eyebrow}>ONE ACCOUNT. YOUR CONTROL.</Text>
    <Text style={ui.title}>Your DataStorm account.{ '\n' }Your KICK’S profile.</Text>
    <Text style={ui.body}>Log in to your DataStorm consumer identity to access your KICK’S profile, devices, privacy choices, and wallet.</Text>
    {status === 'restoring' ? <View accessibilityLiveRegion="polite"><ActivityIndicator color={colors.orange} /><Text style={ui.body}>Restoring your secure session…</Text></View> : <>
      {error ? <Text accessibilityLiveRegion="polite" style={ui.body}>{error === 'session_expired' ? 'Your session expired. Please log in again.' : error.startsWith('Sign-out') ? error : status === 'unavailable' ? 'DataStorm account access is unavailable. You can retry session restoration.' : ''}</Text> : null}
      <View style={s.options}>
        {(['login', 'create', 'recovery'] as const).map(value => <AccountButton key={value} label={value === 'login' ? 'Log In' : value === 'create' ? 'Create Account' : 'Recovery'} disabled={busy} onPress={() => { setMode(value); setPassword(''); setMessage(null); }} />)}
      </View>
      <Card>
        <Text style={ui.h2}>{mode === 'login' ? 'Log in to DataStorm' : mode === 'create' ? 'Create your DataStorm account' : 'Recover account access'}</Text>
        <TextInput accessibilityLabel="Email address" autoComplete="email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} editable={!busy} placeholder="Email address" placeholderTextColor={colors.muted} style={s.input} />
        {mode !== 'recovery' ? <TextInput accessibilityLabel="Password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} secureTextEntry value={password} onChangeText={setPassword} editable={!busy} placeholder="Password" placeholderTextColor={colors.muted} style={s.input} /> : null}
        {mode === 'create' ? <Text style={ui.body}>DataStorm manages account verification and security. KICK’S does not create a separate user account.</Text> : null}
        <AccountButton label={busy ? 'Please wait…' : mode === 'recovery' ? 'Send recovery instructions' : mode === 'create' ? 'Create DataStorm Account' : 'Log In and Open KICK’S'} onPress={() => void submit()} disabled={busy || !email.trim() || (mode !== 'recovery' && !password)} />
        {message ? <Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text> : null}
      </Card>
      <AccountButton label="Restore existing session" disabled={busy} onPress={() => void restore()} />
    </>}
    <View style={s.options}><AccountButton label="Privacy" onPress={() => policy('privacy')} /><AccountButton label="Terms" onPress={() => policy('terms')} /></View>
  </Screen>;
}
const s = StyleSheet.create({ options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, input: { color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: 10, padding: 14, minHeight: 48 } });
