import { StyleSheet, Text, View } from 'react-native';
import { BrandHeader, Card, MascotHero, Screen, colors, ui } from '../components/Brand';
import { ActivityFeed } from '../components/ActivityFeed';
import { ConsumerResourceScreen } from '../components/ConsumerResourceScreen';

export default function Home() { return <ConsumerResourceScreen kind="snapshot" />; }
export function ActivityDemo() {
  return (
    <Screen>
      <BrandHeader section="Privacy and data-value command center" />
      <MascotHero />
      <View style={s.stats}>
        <Card><Text style={ui.label}>APPS SEEN</Text><Text style={s.stat}>12</Text></Card>
        <Card><Text style={ui.label}>DOMAINS</Text><Text style={s.stat}>47</Text></Card>
        <Card><Text style={ui.label}>REVIEW</Text><Text style={[s.stat, ui.orange]}>3</Text></Card>
      </View>
      <ActivityFeed />
      <Text style={s.note}>
        Live & demo observations. Ingestion minimizes metadata locally without capturing payload bodies or private query params.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 8 },
  stat: { color: colors.text, fontSize: 26, fontWeight: '900' },
  note: { color: '#786961', fontSize: 11, lineHeight: 17, marginTop: 6 }
});

