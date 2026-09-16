import { useState } from 'react';
import { Alert, Linking, NativeModules, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { BRAND_MANIFEST } from '../constants/branding';

export default function Settings() {
  const [monitoring, setMonitoring] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const unavailable = (action: string) => Alert.alert(`${action} unavailable in demo`, 'This control is visible now so it can be tested. It will connect to the DataStorm-owned control plane before collection is enabled.');
  const changeMonitoring = async () => {
    if (Platform.OS !== 'android' || !NativeModules.KicksVpn) return unavailable('Monitoring');
    try {
      if (monitoring) { await NativeModules.KicksVpn.stop(); setMonitoring(false); return; }
      const result = await NativeModules.KicksVpn.requestAuthorization();
      if (result === 'authorized') { await NativeModules.KicksVpn.start(); setMonitoring(true); }
      else Alert.alert('Android authorization opened', 'After accepting the Android VPN prompt, return here to start the collector. Collection remains off until the production endpoint is configured.');
    } catch (error) { Alert.alert('Collector not active', error instanceof Error ? error.message : 'The production collector is not configured.'); }
  };

  return <Screen>
    <BrandHeader section="Privacy and beta controls" />
    <Text style={ui.eyebrow}>YOUR CONTROLS</Text>
    <Text style={ui.title}>Private by default.</Text>
    <Text style={ui.body}>Monitoring stays off until you review the disclosure and give explicit permission on Android.</Text>

    <Card accent>
      <SettingRow title="Exfiltration monitoring" detail="Metadata only · no message or payload contents">
        <Switch value={monitoring} onValueChange={changeMonitoring} trackColor={{ false: '#493a32', true: '#8f4319' }} thumbColor={monitoring ? colors.orange : '#a69b94'} />
      </SettingRow>
      <Text style={s.status}>OFF · COLLECTING NOTHING</Text>
    </Card>

    <Card>
      <SettingRow title="Beta diagnostics" detail="Share crashes and performance measurements">
        <Switch value={diagnostics} onValueChange={setDiagnostics} trackColor={{ false: '#493a32', true: '#8f4319' }} thumbColor={diagnostics ? colors.orange : '#a69b94'} />
      </SettingRow>
    </Card>

    <Text style={ui.eyebrow}>DATA RIGHTS</Text>
    <Action title="Review permissions" detail="See, grant, or withdraw purpose-specific uses" onPress={() => unavailable('Permission history')} />
    <Action title="Export my data" detail="Receive observations, permissions, and rewards" onPress={() => unavailable('Data export')} />
    <Action title="Delete account and data" detail="Permanently request deletion from KICK'S systems" danger onPress={() => unavailable('Account deletion')} />

    <Text style={ui.eyebrow}>ABOUT</Text>
    <Card>
      <Text style={ui.h2}>{BRAND_MANIFEST.productName} Private Beta</Text>
      <Text style={ui.body}>Version {BRAND_MANIFEST.minimumAppVersion} · {BRAND_MANIFEST.ownershipLabel}</Text>
      <Text style={[ui.label, { marginTop: 4 }]}>ASSET BUILD: {BRAND_MANIFEST.assetVersion.toUpperCase()}</Text>
      <Pressable onPress={() => Linking.openURL('https://temporary-agile-rowan-w69hwk0.vercel.app')}><Text style={s.link}>Privacy policy · beta publication pending</Text></Pressable>
    </Card>
  </Screen>;
}

function SettingRow({title, detail, children}:{title:string;detail:string;children:React.ReactNode}) { return <View style={s.row}><View style={s.flex}><Text style={s.title}>{title}</Text><Text style={s.detail}>{detail}</Text></View>{children}</View>; }
function Action({title,detail,danger=false,onPress}:{title:string;detail:string;danger?:boolean;onPress:()=>void}) { return <Pressable onPress={onPress}><Card><View style={s.row}><View style={s.flex}><Text style={[s.title,danger&&s.danger]}>{title}</Text><Text style={s.detail}>{detail}</Text></View><Text style={danger?s.danger:s.arrow}>›</Text></View></Card></Pressable>; }
const s=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:14},flex:{flex:1},title:{color:colors.text,fontSize:16,fontWeight:'800'},detail:{color:colors.muted,fontSize:12,lineHeight:18,marginTop:3},status:{color:colors.orange,fontSize:10,fontWeight:'900',letterSpacing:1,marginTop:5},arrow:{color:colors.blue,fontSize:26},danger:{color:colors.red},link:{color:colors.blue,fontSize:12,fontWeight:'700',marginTop:4}});
