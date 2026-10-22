import { parseResponse, isObject } from '../services/requestState.mjs';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from './Brand';
import { useSession } from './SessionProvider';
import { SessionError } from '../services/sessionCore';
import { useMonitoringPolicy } from './useMonitoringPolicy';

interface Device { device_id: string; display_name: string | null; platform: string; }
interface Consent { action: 'grant' | 'deny' | 'revoke'; purpose: string; permissionId: string; policyVersion: string; purposeVersion: string; occurredAt: string; }
export function AccountPermissions() {
  const { manager, user } = useSession();
  return <AccountPermissionsBody key={`${user?.subjectId ?? 'signed-out'}:${manager.sessionGeneration}`} />;
}
function AccountPermissionsBody() {
  const { manager, user, ready, sessionWarning } = useSession();
  const { policy, configured } = useMonitoringPolicy();
  const { permissionId, policyVersion, purposeVersion, purpose } = policy;
  const flight = useRef(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [consent, setConsent] = useState<Consent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = async (id: string) => {
    const account = manager.user;
    const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(id) + '/consent?permissionId=' + encodeURIComponent(permissionId ?? ''));
    if (!response.ok) throw new SessionError('Your saved permission could not be confirmed. Reload before making changes.');
    const result = await parseResponse(response, value => isObject(value) && Object.hasOwn(value, 'consent') && (value.consent === null || isObject(value.consent)));
    if (result.consent && (result.consent.permissionId !== permissionId ||
        result.consent.purpose !== purpose || result.consent.policyVersion !== policyVersion ||
        result.consent.purposeVersion !== purposeVersion ||
        !['grant', 'deny', 'revoke'].includes(result.consent.action))) {
      throw new SessionError('This device needs a reviewed permission update. No changes were made.');
    }
    if (!account || manager.user !== account) throw new SessionError('Your session changed. Reload permissions.');
    setConsent(result.consent);
    setLoaded(true);
  };
  const load = async () => {
    if (flight.current) return;
    flight.current = true;
    const account = manager.user;
    setBusy(true); setError(null); setLoaded(false); setConsent(null);
    try {
      const response = await manager.request('/core/consumer/v1/devices');
      if (!response.ok) throw new SessionError('Connected devices could not be loaded.');
      const result = await parseResponse(response, value => isObject(value) && Array.isArray(value.devices) && value.devices.every((device: any) => typeof device?.device_id === 'string'));
      const list: Device[] = Array.isArray(result.devices) ? result.devices : [];
      if (!account || manager.user !== account) return;
      setDevices(list);
      const selected = list.find(item => item.device_id === deviceId)?.device_id ?? list[0]?.device_id ?? '';
      setDeviceId(selected);
      if (selected && configured) await read(selected);
    } catch (failure) { setError(failure instanceof SessionError ? failure.message : 'Permissions are unavailable. Try again.'); }
    finally { flight.current = false; setBusy(false); }
  };
  useEffect(() => {
    setDevices([]); setDeviceId(''); setConsent(null); setLoaded(false);
    if (ready && user) void load();
  }, [ready, user?.subjectId, configured, permissionId, policyVersion, purposeVersion, purpose]);
  const select = async (id: string) => {
    if (flight.current) return;
    flight.current = true;
    setDeviceId(id); setConsent(null); setLoaded(false);
    if (!configured) { flight.current = false; return; }
    setBusy(true); setError(null);
    try { await read(id); } catch { setError('Your saved permission could not be confirmed. Reload before making changes.'); }
    finally { flight.current = false; setBusy(false); }
  };
  const decide = async (action: 'grant' | 'revoke') => {
    if (flight.current || !loaded || !configured) return;
    flight.current = true;
    setBusy(true); setError(null); setLoaded(false);
    try {
      // This identifies the decision request, never the collector subject.
      const activationRequestId = randomUUID();
      const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(deviceId) + '/consent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissionId, policyVersion, purposeVersion, purpose, action, activationRequestId })
      });
      if (!response.ok) throw new SessionError('Your permission change could not be confirmed. Reload to check the saved decision.');
      await read(deviceId);
    } catch (failure) { setError(failure instanceof SessionError ? failure.message : 'Your permission change could not be confirmed. Reload before trying again.'); }
    finally { flight.current = false; setBusy(false); }
  };
  return <Screen>
    <BrandHeader section="Account permissions" />
    <Text style={ui.title}>Your permission comes first.</Text>
    <Text style={ui.body}>Signing in does not start monitoring or authorize commercial data sharing.</Text>
    {sessionWarning && <Card><Text accessibilityRole="alert" style={ui.body}>{sessionWarning}</Text><Pressable accessibilityRole="button" onPress={() => router.push('/account')}><Text style={ui.label}>REVIEW SIGN-OUT STATUS</Text></Pressable></Card>}
    {!ready ? <ActivityIndicator color={colors.orange} /> : !user ? <Card>
      <Text style={ui.h2}>Connect your DataStorm account</Text>
      <Text style={ui.body}>Sign in to review the devices and permissions linked to your account.</Text>
      <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} onPress={() => router.push('/account')}><Text style={ui.label}>SIGN IN</Text></Pressable>
    </Card> : <>
      <Card><Text style={ui.h2}>Connected devices</Text>
        {devices.map(device => <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} key={device.device_id} disabled={busy} onPress={() => select(device.device_id)}>
          <Text style={[ui.body, device.device_id === deviceId && { color: colors.orange }]}>{device.display_name || device.platform + ' device'}{device.device_id === deviceId ? ' · selected' : ''}</Text>
        </Pressable>)}
        {!busy && !error && !devices.length && <Text style={ui.body}>No device is connected yet. Monitoring remains unavailable until device setup is complete.</Text>}
      </Card>
      {!configured ? <Card><Text style={ui.body}>Monitoring setup is pending for this beta. Consent controls will appear when setup is complete.</Text></Card> : deviceId && <Card>
        <Text style={ui.h2}>Network monitoring permission</Text>
        <Text style={ui.body}>{purpose}</Text>
        <Text style={ui.body}>This permission covers the reviewed monitoring purpose only. It does not authorize compensated studies or sharing your data.</Text>
        <Text style={ui.label}>{!loaded ? 'NOT CONFIRMED' : consent?.action === 'grant' ? 'PERMISSION GRANTED' : 'PERMISSION NOT GRANTED'}</Text>
        <View style={{ flexDirection: 'row', gap: 24 }}>
          <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} disabled={busy || !loaded} onPress={() => decide('grant')}><Text style={ui.label}>GRANT</Text></Pressable>
          <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} disabled={busy || !loaded} onPress={() => decide('revoke')}><Text style={ui.label}>REVOKE</Text></Pressable>
        </View>
        <Text style={ui.body}>A saved permission does not mean the iOS collector is running.</Text>
      </Card>}
      <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} disabled={busy} onPress={load}><Text style={ui.label}>RELOAD PERMISSIONS</Text></Pressable>
    </>}
    {busy && <ActivityIndicator color={colors.orange} />}
    {error && <Card><Text accessibilityRole="alert" style={ui.body}>{error}</Text></Card>}
  </Screen>;
}
