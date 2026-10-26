import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, NativeModules, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { BRAND_MANIFEST } from '../constants/branding';

type CollectorStatus = { state: 'idle' | 'starting' | 'active' | 'paused' | 'stopped'; reason: string | null; collectorConfigured: boolean };
const REASON_TEXT: Record<string, string> = {
  COLLECTOR_DISABLED: 'The collector is disabled in this build.',
  AUTHORITY_NOT_CONFIGURED: 'The collector service is not configured for this build.',
  NO_SESSION: 'Sign in and connect this device first.',
  SESSION_EXPIRED: 'Your session expired. Sign in again.',
  SESSION_REVOKED: 'Your session was revoked or is no longer valid.',
  CROSS_ACCOUNT_REJECTED: 'This device is linked to a different account. Sign in with the original account or unlink the device.',
  DEVICE_NOT_OWNED: 'This device is not confirmed as owned by your account.',
  CONSENT_NOT_GRANTED: 'Collection consent is not granted for this purpose.',
  DATA_SHARING_OFF: 'Data sharing is turned off.',
  OS_VPN_NOT_AUTHORIZED: 'Android VPN authorization is missing or was withdrawn.',
  NOTIFICATIONS_BLOCKED: 'Allow notifications so monitoring is always visible.',
  AUTHORITY_UNAVAILABLE: 'Authorization could not be confirmed. Nothing is collected.',
  TUNNEL_FAILED: 'The Android tunnel could not be started.',
  NO_UPSTREAM_DNS: 'No network is available to forward traffic.',
};
const reasonText = (reason: string | null) => (reason && REASON_TEXT[reason]) || 'Monitoring is not active.';

export default function Settings() {
  const [monitoring, setMonitoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const unavailable = (action: string) => Alert.alert(`${action} unavailable in demo`, 'This control is visible now so it can be tested. It will connect to the DataStorm-owned control plane before collection is enabled.');
  const native = Platform.OS === 'android' ? NativeModules.KicksVpn : undefined;

  // The switch only ever mirrors the native collector, which in turn only reports "active" after the
  // authoritative gate allowed it and the tunnel is up. Polling also reflects revocation/expiry/OS loss.
  const refresh = useCallback(async (): Promise<CollectorStatus | undefined> => {
    if (!native?.getStatus) return undefined;
    try {
      const status: CollectorStatus = await native.getStatus();
      setMonitoring(status.state === 'active');
      return status;
    } catch { setMonitoring(false); return undefined; }
  }, [native]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const changeMonitoring = async () => {
    if (!native) return unavailable('Monitoring');
    if (busy) return;
    setBusy(true);
    try {
      if (monitoring) { await native.stop(); await refresh(); return; }
      const result = await native.requestAuthorization();
      if (result !== 'authorized') {
        Alert.alert('Android authorization opened', 'After accepting the Android VPN prompt, return here and turn monitoring on again. Nothing is collected until you do.');
        return;
      }
      await native.start();
      let status: CollectorStatus | undefined;
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        status = await refresh();
        if (status && status.state !== 'starting' && status.state !== 'idle') break;
      }
      if (status?.state !== 'active') Alert.alert('Monitoring is not active', reasonText(status?.reason ?? null));
    } catch (error: any) {
      Alert.alert('Monitoring is not active', error?.code === 'DEVICE_OWNED_BY_OTHER_ACCOUNT' ? reasonText('CROSS_ACCOUNT_REJECTED') : error instanceof Error ? error.message : 'The collector is not configured.');
      await refresh();
    } finally { setBusy(false); }
  };

  return <Screen>
    <BrandHeader section="Privacy and beta controls" />
    <Text style={ui.eyebrow}>YOUR CONTROLS</Text>
    <Text style={ui.title}>Private by default.</Text>
    <Text style={ui.body}>Monitoring stays off until you review the disclosure and give explicit permission on Android.</Text>

    <Card accent>
      <SettingRow title="Exfiltration monitoring" detail="Metadata only · no message or payload contents">
        <Switch value={monitoring} disabled={busy} onValueChange={changeMonitoring} trackColor={{ false: '#493a32', true: '#8f4319' }} thumbColor={monitoring ? colors.orange : '#a69b94'} />
      </SettingRow>
      <Text style={s.status}>{monitoring ? 'ACTIVE · METADATA ONLY' : 'OFF · COLLECTING NOTHING'}</Text>
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
