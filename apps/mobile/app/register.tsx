import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { createDataStormAccount } from '../services/registrationService';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL;
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
  const configured = !!(termsUrl && privacyUrl && process.env.EXPO_PUBLIC_TERMS_VERSION && process.env.EXPO_PUBLIC_PRIVACY_VERSION);
  const submit = async () => {
    if (busy) return;
    if (password.length < 12 || password.length > 128) { setError('Use a password between 12 and 128 characters.'); return; }
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await createDataStormAccount(email, password, accepted);
      setPassword(''); setConfirmation(''); setCreated(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Registration failed. Try again.');
    } finally { setBusy(false); }
  };
  return <Screen>
    <BrandHeader section="DataStorm account" />
    <Text style={ui.title}>Create your account</Text>
    <Text style={ui.body}>One DataStorm identity connects your KICK’S consumer profile. Creating an account does not enable monitoring or data sharing.</Text>
    {created ? <Card>
      <Text style={ui.h2}>Account created</Text>
      <Text style={ui.body}>Check your email for DataStorm verification instructions. You can then sign in to KICK’S.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/account')}><Text style={s.link}>Continue to Sign In</Text></Pressable>
    </Card> : <Card>
      <Text style={ui.label}>EMAIL</Text>
      <TextInput accessibilityLabel="Registration email" style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy} />
      <Text style={ui.label}>PASSWORD (12+ CHARACTERS)</Text>
      <TextInput accessibilityLabel="Registration password" style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" editable={!busy} />
      <Text style={ui.label}>CONFIRM PASSWORD</Text>
      <TextInput accessibilityLabel="Confirm registration password" style={s.input} value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" editable={!busy} />
      <Pressable accessibilityRole="link" disabled={!termsUrl} onPress={() => termsUrl && Linking.openURL(termsUrl)}><Text style={s.link}>Read DataStorm Terms of Service</Text></Pressable>
      <Pressable accessibilityRole="link" disabled={!privacyUrl} onPress={() => privacyUrl && Linking.openURL(privacyUrl)}><Text style={s.link}>Read DataStorm Privacy Policy</Text></Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} disabled={!configured || busy} onPress={() => setAccepted(!accepted)}>
        <Text style={s.link}>{accepted ? '☑' : '☐'} I agree to the Terms and Privacy Policy</Text>
      </Pressable>
      {!configured && <Text accessibilityRole="alert" style={ui.body}>Registration is not yet available. Approved terms, privacy links and policy versions must be configured before accounts can be created.</Text>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={!configured || !accepted || busy || !email.trim() || !password || !confirmation} onPress={submit}>
        <Text style={s.link}>{busy ? 'Creating account…' : 'Create Account'}</Text>
      </Pressable>
      {busy && <ActivityIndicator color={colors.orange} />}
    </Card>}
    <Pressable accessibilityRole="button" onPress={() => router.replace('/account')}><Text style={s.link}>Already have an account? Sign In</Text></Pressable>
  </Screen>;
}
const s = StyleSheet.create({
  input: { color: colors.text, borderWidth: 1, borderColor: '#493a32', borderRadius: 10, padding: 12, fontSize: 16 },
  link: { color: colors.orange, fontSize: 16, fontWeight: '700', paddingVertical: 12 },
  error: { color: colors.red, fontSize: 14 }
});
