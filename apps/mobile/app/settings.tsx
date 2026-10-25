import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { BRAND_MANIFEST } from '../constants/branding';
import {
  DeviceSessionError,
  hasStoredDeviceSession,
  isIdentityTokenProviderRegistered,
  logoutDevice,
  restoreDeviceSession
} from '../services/deviceSession';

type SessionStatus = 'checking' | 'active' | 'missing' | 'unavailable';

export default function Settings() {
  const [diagnostics, setDiagnostics] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('checking');
  const [hasStoredSession, setHasStoredSession] = useState(false);
  const [identityProviderRegistered, setIdentityProviderRegistered] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const unavailable = (action: string) => Alert.alert(`${action} unavailable in demo`, 'This control is visible now so it can be tested. It will connect to the DataStorm-owned control plane before collection is enabled.');

  const refreshSession = useCallback(async () => {
    setSessionStatus('checking');
    setSessionMessage(null);
    setIdentityProviderRegistered(isIdentityTokenProviderRegistered());
    let stored: boolean;
    try {
      stored = await hasStoredDeviceSession();
    } catch {
      setSessionStatus('unavailable');
      setSessionMessage('Secure session status could not be read. No session state is assumed.');
      return;
    }
    setHasStoredSession(stored);
    if (!stored) {
      setSessionStatus('missing');
      return;
    }
    try {
      const session = await restoreDeviceSession();
      setHasStoredSession(session !== null);
      setSessionStatus(session ? 'active' : 'missing');
    } catch (error) {
      setSessionStatus('unavailable');
      setSessionMessage(error instanceof DeviceSessionError && error.status === 503
        ? 'The session service is unavailable. Stored credentials remain on this device; server status is unconfirmed.'
        : 'The stored session could not be verified. Credentials remain on this device; retry or log out to clear them.');
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const logoutSession = async () => {
    setSessionActionBusy(true);
    setSessionMessage(null);
    try {
      const result = await logoutDevice();
      setHasStoredSession(false);
      setSessionStatus('missing');
      setSessionMessage(result.remoteRevocationConfirmed
        ? 'Local credentials were cleared, and the server confirmed device revocation.'
        : 'Local credentials were cleared. Remote revocation was not confirmed; server status is unknown.');
    } catch {
      setSessionStatus('unavailable');
      setSessionMessage('Could not confirm that local credentials were cleared or remote revocation completed.');
    } finally {
      setSessionActionBusy(false);
    }
  };

  const sessionDescription = sessionStatus === 'checking'
    ? 'Checking stored credentials and verifying the session with the service…'
    : sessionStatus === 'active'
      ? 'Active · the secure device session was verified with the service.'
      : sessionStatus === 'unavailable'
        ? sessionMessage ?? 'The secure session is unavailable. No permission is assumed.'
        : identityProviderRegistered
          ? 'No active secure session. Login and enrollment are not configured in Settings.'
          : 'No active secure session. Login and device enrollment are unavailable because no identity-token provider is registered.';

  return <Screen>
    <BrandHeader section="Privacy and beta controls" />
    <Text style={ui.eyebrow}>YOUR CONTROLS</Text>
    <Text style={ui.title}>Private by default.</Text>
    <Text style={ui.body}>Monitoring stays off until you review the disclosure and give explicit permission on Android.</Text>

    <Text style={ui.eyebrow}>ACCOUNT &amp; DEVICE SESSION</Text>
    <Card>
      <View style={s.sessionHeading}>
        <View style={s.flex}>
          <Text style={s.title}>Secure device session</Text>
          <Text style={s.detail}>{sessionDescription}</Text>
          {sessionMessage && sessionStatus !== 'unavailable' && (
            <Text accessibilityLiveRegion="polite" style={s.sessionResult}>{sessionMessage}</Text>
          )}
        </View>
        {sessionStatus === 'checking' && <ActivityIndicator color={colors.orange} />}
      </View>
      <View style={s.sessionActions}>
        <Pressable
          accessibilityRole="button"
          disabled={sessionActionBusy || sessionStatus === 'checking'}
          onPress={() => void refreshSession()}
          style={s.sessionButton}
        >
          <Text style={s.sessionButtonText}>Refresh status</Text>
        </Pressable>
        {hasStoredSession && (
          <Pressable
            accessibilityRole="button"
            disabled={sessionActionBusy || sessionStatus === 'checking'}
            onPress={() => void logoutSession()}
            style={[s.sessionButton, s.sessionLogoutButton]}
          >
            <Text style={[s.sessionButtonText, s.sessionLogoutText]}>
              {sessionActionBusy ? 'Clearing…' : 'Log out and revoke'}
            </Text>
          </Pressable>
        )}
      </View>
    </Card>

    <Card accent>
      <SettingRow title="Exfiltration monitoring" detail="Unavailable in this build · no traffic is collected">
        <Switch value={false} disabled trackColor={{ false: '#493a32', true: '#8f4319' }} thumbColor="#a69b94" />
      </SettingRow>
      <Text style={s.status}>UNAVAILABLE · COLLECTING NOTHING</Text>
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
const s=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:14},flex:{flex:1},title:{color:colors.text,fontSize:16,fontWeight:'800'},detail:{color:colors.muted,fontSize:12,lineHeight:18,marginTop:3},status:{color:colors.orange,fontSize:10,fontWeight:'900',letterSpacing:1,marginTop:5},arrow:{color:colors.blue,fontSize:26},danger:{color:colors.red},link:{color:colors.blue,fontSize:12,fontWeight:'700',marginTop:4},sessionHeading:{flexDirection:'row',alignItems:'center',gap:12},sessionActions:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:16},sessionButton:{paddingVertical:9,paddingHorizontal:12,borderRadius:8,backgroundColor:'#18302d'},sessionButtonText:{color:colors.blue,fontSize:12,fontWeight:'800'},sessionLogoutButton:{backgroundColor:'#38201b'},sessionLogoutText:{color:colors.red},sessionResult:{color:colors.text,fontSize:12,lineHeight:18,marginTop:8}});
