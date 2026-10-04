import { useCallback, useState } from 'react';
import { Alert, Linking, NativeModules, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BrandHeader, Card, LegacyKicksTransitionMark, Screen, colors, ui } from '../components/Brand';

type KicksVpnBridge = {
  isActive(): Promise<boolean>;
  isProvisioned(): Promise<boolean>;
  grantMonitoringConsent(): Promise<string>;
  revokeMonitoringConsent(): Promise<string>;
  requestAuthorization(): Promise<'authorized' | 'authorization_opened' | 'denied'>;
  start(): Promise<string>;
  stop(): Promise<string>;
};
const bridge = NativeModules.KicksVpn as KicksVpnBridge | undefined;

export default function Settings() {
  const [monitoring, setMonitoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provisioned, setProvisioned] = useState<boolean | null>(null);

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android' || !bridge) return;
    let mounted = true;
    const sync = async () => {
      try {
        const [isActive, isProvisioned] = await Promise.all([bridge.isActive(), bridge.isProvisioned()]);
        if (mounted) { setMonitoring(isActive); setProvisioned(isProvisioned); }
      } catch {}
    };
    void sync();
    const timer = setInterval(() => void sync(), 15_000);
    return () => { mounted = false; clearInterval(timer); };
  }, []));

  const changeMonitoring = async () => {
    if (Platform.OS !== 'android' || !bridge || busy) return;
    setBusy(true);
    let freshGrantCreated = false;
    try {
      if (monitoring) {
        await bridge.stop();
        await bridge.revokeMonitoringConsent();
        setMonitoring(false);
        return;
      }
      if (!(await bridge.isProvisioned())) throw new Error('This device has not been securely provisioned for the KICK’S staging service.');
      await bridge.grantMonitoringConsent();
      freshGrantCreated = true;
      const authorization = await bridge.requestAuthorization();
      if (authorization !== 'authorized') {
        await bridge.revokeMonitoringConsent();
        freshGrantCreated = false;
        Alert.alert('Android approval required', 'Approve the VPN connection, then return and switch monitoring on again. A fresh KICK’S consent grant will be created for that activation.');
        return;
      }
      await bridge.start();
      freshGrantCreated = false;
      setMonitoring(true);
    } catch (error) {
      if (freshGrantCreated) {
        try { await bridge.revokeMonitoringConsent(); } catch {}
      }
      Alert.alert('Monitoring not changed', error instanceof Error ? error.message : 'Unable to change monitoring.');
    } finally {
      setBusy(false);
    }
  };

  return <Screen>
    <BrandHeader section="Privacy and device controls" />
    <Text style={ui.eyebrow}>YOUR CONTROLS</Text>
    <Text style={ui.title}>Private by default.</Text>
    <Text style={ui.body}>Monitoring stays off until you explicitly activate it. Every new activation creates a fresh monitoring consent record before Android network authorization and collection.</Text>

    <Card accent>
      <SettingRow title="Exfiltration monitoring" detail="Destination metadata only · no message or payload contents">
        <Switch disabled={busy || !bridge} value={monitoring} onValueChange={() => void changeMonitoring()} trackColor={{ false: '#493a32', true: '#285d44' }} thumbColor={monitoring ? colors.green : '#a69b94'} />
      </SettingRow>
      <Text style={monitoring ? s.active : s.inactive}>{busy ? 'UPDATING' : monitoring ? 'ON · CONSENT-GATED MONITORING' : 'OFF · COLLECTING NOTHING'}</Text>
      <Text style={s.detailStatus}>{provisioned === null ? 'Checking secure device enrollment…' : provisioned ? 'Secure device enrollment found.' : 'Secure device enrollment required before activation.'}</Text>
    </Card>

    <Card>
      <Text style={ui.eyebrow}>ACTIVATION ORDER</Text>
      <Text style={ui.body}>1. Fresh KICK’S monitoring consent{`\n`}2. Android VPN authorization{`\n`}3. Collector activation{`\n`}4. Consent-linked Engine verification</Text>
      <Text style={s.boundary}>An Android VPN approval by itself never authorizes KICK’S monitoring.</Text>
    </Card>

    <Text style={ui.eyebrow}>DATA RIGHTS</Text>
    <Card>
      <Text style={ui.h2}>Consent records stay separate.</Text>
      <Text style={ui.body}>Monitoring permission authorizes private transparency collection only. Commercial sharing requires a separate, purpose-specific decision in Permissions and cannot be inferred from monitoring status.</Text>
    </Card>

    <Text style={ui.eyebrow}>ABOUT</Text>
    <Card>
      <Text style={ui.h2}>KICK'S 0.2.6</Text>
      <Text style={ui.body}>Live Android engine build · A product of DataStorm Inc.</Text>
      <View style={s.legacyRow}><Text style={s.legacyLabel}>FORMERLY</Text><LegacyKicksTransitionMark /></View>
      <Pressable onPress={() => Linking.openURL('https://temporary-agile-rowan-w69hwk0.vercel.app')}><Text style={s.link}>Privacy policy</Text></Pressable>
    </Card>
  </Screen>;
}

function SettingRow({title, detail, children}:{title:string;detail:string;children:React.ReactNode}) { return <View style={s.row}><View style={s.flex}><Text style={s.title}>{title}</Text><Text style={s.detail}>{detail}</Text></View>{children}</View>; }
const s=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:14},flex:{flex:1},title:{color:colors.text,fontSize:16,fontWeight:'800'},detail:{color:colors.muted,fontSize:12,lineHeight:18,marginTop:3},active:{color:colors.green,fontSize:10,fontWeight:'900',letterSpacing:1,marginTop:5},inactive:{color:colors.orange,fontSize:10,fontWeight:'900',letterSpacing:1,marginTop:5},detailStatus:{color:'#8f8179',fontSize:10,lineHeight:15},boundary:{color:colors.orange,fontSize:10,lineHeight:15,fontWeight:'800'},legacyRow:{flexDirection:'row',alignItems:'center',gap:8,marginTop:3},legacyLabel:{color:'#806f65',fontSize:9,fontWeight:'900',letterSpacing:1},link:{color:colors.blue,fontSize:12,fontWeight:'700',marginTop:4}});
