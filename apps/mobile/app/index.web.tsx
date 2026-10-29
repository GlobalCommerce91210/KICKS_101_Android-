import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { useSession } from '../components/SessionProvider';

const inputs = [
  { name: 'Account and profile', kind: 'User supplied', route: '/profile', source: 'Authenticated account service', fields: 'Account identity, profile, product access and linked devices', meaning: 'Identifies the account requesting a view. Account identity and collector/device identity are separate.', evidence: 'Sign in to inspect the account response. No account values are loaded by this inventory.' },
  { name: 'Device enrollment', kind: 'Service record', route: '/my-devices', source: 'Account-to-device binding service', fields: 'Platform, binding status and enrolled-device references', meaning: 'Enrollment links an account and device. It does not establish OS approval, eligibility or active monitoring.', evidence: 'Requires authenticated device records. The browser cannot inspect native Keychain or VPN state.' },
  { name: 'Traffic observations', kind: 'Observed metadata', route: '/engine', source: 'Native collector and authorized ingestion', fields: 'Protocol and bounded traffic size where supported', meaning: 'Only fields supported by collection evidence may be presented as observed. App attribution, hostnames and content are not guaranteed.', evidence: 'No accepted live collection feed is connected to this overview. Monitoring is OFF; existing sample observations are synthetic.' },
  { name: 'Permissions and consent', kind: 'User decision', route: '/permissions', source: 'Authoritative consent service', fields: 'Purpose, scope, grant/revocation status and available history', meaning: 'A saved permission must match its purpose and device context. A grant alone does not prove activation or partner delivery.', evidence: 'Review authenticated permissions and server history. Missing policy versions, timestamps or evidence must remain unavailable.' },
  { name: 'Opportunities and partner sharing', kind: 'Partner/service input', route: '/opportunities', source: 'Marketplace offers and sharing records', fields: 'Buyer category, requested metadata, purpose, offer terms and sharing status', meaning: 'Offer estimates are not earnings. Sharing requires valid consent and independently accepted delivery evidence.', evidence: 'Existing demo offers do not establish a connected marketplace or successful partner receipt.' },
  { name: 'Rewards and wallet', kind: 'Derived / ledger', route: '/wallet', source: 'Reward calculations and wallet service', fields: 'Calculation inputs, valuation basis, pending/settled entries and payout prerequisites', meaning: 'Show estimated, earned, pending and paid amounts separately. A displayed balance does not prove a payout.', evidence: 'Inspect available authenticated wallet records. Calculation provenance and provider settlement evidence are still required.' },
] as const;

export default function WebOverview() {
  const { user, ready } = useSession();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => inputs.filter(item => `${item.name} ${item.kind} ${item.fields}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <Screen>
    <View style={s.page}>
      <BrandHeader section="Your complete KICK’S picture — inputs, decisions and outcomes" />
      <Text accessibilityRole="header" style={ui.title}>Understand every input.</Text>
      <Text style={ui.body}>Explore what each part of KICK’S uses, where it comes from and what it can tell you. This web workspace provides more context than the compact mobile views.</Text>
      <View style={s.summary}>
        <View style={s.summaryCard}><Card><Text style={ui.eyebrow}>ACCOUNT</Text><Text style={ui.h2}>{!ready ? 'Checking session' : user ? 'Signed in' : 'Not signed in'}</Text><Text style={ui.body}>Account details are available through your protected profile.</Text></Card></View>
        <View style={s.summaryCard}><Card><Text style={ui.eyebrow}>COLLECTION</Text><Text style={ui.h2}>Monitoring OFF</Text><Text style={ui.body}>No device collection or browser-wide observation is claimed.</Text></Card></View>
        <View style={s.summaryCard}><Card><Text style={ui.eyebrow}>EVIDENCE</Text><Text style={ui.h2}>Availability matters</Text><Text style={ui.body}>This inventory explains inputs; it does not fetch or certify live values.</Text></Card></View>
      </View>
      <Card accent><Text style={ui.h2}>Read the source before the score</Text><Text style={ui.body}>For a complete record, look for its origin, observation time, last refresh, consent purpose and policy version. Derived results also need calculation inputs. When those fields are missing, the result remains unverified. Sample activity, offer values and “live” simulations in existing demo screens are not accepted collection or earnings evidence.</Text></Card>
      <Text accessibilityRole="header" style={ui.h2}>Input inventory</Text>
      <TextInput accessibilityLabel="Search input inventory" placeholder="Search account, consent, rewards…" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={s.search} />
      <View style={s.grid}>{visible.map(item => <View key={item.name} style={s.input}><Card>
        <Text style={ui.eyebrow}>{item.kind.toUpperCase()}</Text><Text accessibilityRole="header" style={ui.h2}>{item.name}</Text>
        <Text style={s.label}>SOURCE</Text><Text style={ui.body}>{item.source}</Text>
        <Text style={s.label}>INPUTS TO INSPECT</Text><Text style={ui.body}>{item.fields}</Text>
        <Text style={s.label}>WHAT THEY MEAN</Text><Text style={ui.body}>{item.meaning}</Text>
        <Text style={s.label}>CURRENT AVAILABILITY & LIMITS</Text><Text style={ui.body}>{item.evidence}</Text>
        <Pressable accessibilityRole="link" onPress={() => router.push(item.route)} style={s.link}><Text style={s.linkText}>Open {item.name.toLowerCase()} →</Text></Pressable>
      </Card></View>)}</View>
      {!visible.length && <Text accessibilityRole="alert" style={ui.body}>No inputs match. Try a broader search.</Text>}
      <Card><Text style={ui.h2}>Your choices and next steps</Text><Text style={ui.body}>Review permissions before sharing; inspect opportunity terms before participating; distinguish wallet estimates from settled rewards. Use Settings for account and data-rights controls. Unavailable controls and missing records need to be resolved before release acceptance.</Text><Pressable accessibilityRole="link" onPress={() => router.push('/settings')} style={s.link}><Text style={s.linkText}>Review settings →</Text></Pressable></Card>
    </View>
  </Screen>;
}

const s = StyleSheet.create({
  page: { width: '100%', maxWidth: 1320, alignSelf: 'center', gap: 18 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  summaryCard: { flexGrow: 1, flexBasis: 280 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  input: { flexGrow: 1, flexBasis: 460 },
  search: { color: colors.text, borderWidth: 1, borderColor: '#665247', padding: 14, borderRadius: 10, fontSize: 16 },
  label: { color: '#e8b990', fontSize: 11, fontWeight: '800', marginTop: 10, letterSpacing: 1 },
  link: { paddingVertical: 14, marginTop: 6 },
  linkText: { color: '#ffac71', fontWeight: '700', fontSize: 15 },
});
