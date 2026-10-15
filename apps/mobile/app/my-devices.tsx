import { useCallback, useRef, useState } from 'react';
import { Alert, NativeModules, Platform, Pressable, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { BrandHeader, Card, Screen, ui } from '../components/Brand';
import { useSession } from '../components/SessionProvider';
import { loadConsumerProfile, type ConsumerProfileView } from '../services/profileService';
import { selectIosNativeAdapter } from '../services/iosNativeAdapter.mjs';
import { enrollCurrentDevice, revokeAndUnlinkDevice } from '../services/deviceService.mjs';
import { IosCollectorControls } from '../components/IosCollectorControls';

export default function MyDevices() {
  const { manager, ready, user } = useSession();
  const [loaded, setLoaded] = useState<ConsumerProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const flight = useRef(false);
  const generation = useRef(0);
  const native = selectIosNativeAdapter(Platform.OS,
    Platform.OS === 'ios' ? requireOptionalNativeModule('KicksTunnel') : null, NativeModules.KicksTunnel);
  const profile = loaded?.account.subjectId === user?.subjectId ? loaded : null;
  const refresh = useCallback(async () => {
    const account = manager.user;
    if (!account) return;
    const id = ++generation.current;
    try {
      const next = await loadConsumerProfile(manager);
      if (id === generation.current && manager.user === account) { setLoaded(next); setError(null); }
    } catch { if (id === generation.current && manager.user === account) setError('Devices could not be loaded. Check your connection and refresh.'); }
  }, [manager]);
  useFocusEffect(useCallback(() => {
    if (ready && !user) router.replace('/account');
    else if (ready) void refresh();
    return () => { ++generation.current; };
  }, [ready, user, refresh]));
  const run = async (operation: () => Promise<unknown>) => {
    if (flight.current || collectionBusy) return;
    const account = manager.user;
    const id = generation.current;
    flight.current = true; setBusy(true); setError(null);
    try { await operation(); if (generation.current === id && manager.user === account) await refresh(); }
    catch (failure) { if (generation.current === id && manager.user === account) setError(failure instanceof Error ? failure.message : 'Device action failed. Refresh and retry.'); }
    finally { flight.current = false; setBusy(false); }
  };
  if (!ready || !user) return null;
  return <Screen>
    <BrandHeader section="My Devices" />
    <Text style={ui.title}>My Devices</Text>
    <Text style={ui.body}>Your DataStorm account, this device, and its collector have separate identities. Enrollment alone does not start collection.</Text>
    {error && <Text accessibilityRole="alert" style={ui.body}>{error}</Text>}
    <Card>
      <Text style={ui.h2}>This device</Text>
      <Pressable accessibilityRole="button" disabled={busy || collectionBusy || !native?.provision} style={{minHeight:44,justifyContent:'center'}} onPress={() => Alert.alert('Enroll this device?', 'Link this device securely to your signed-in account. Collection remains off until you choose Set Up Collection and approve its purpose.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Enroll', onPress: () => { void run(() => enrollCurrentDevice(manager, native)); } },
      ])}><Text style={ui.label}>{busy ? 'PLEASE WAIT.' : 'ENROLL THIS DEVICE'}</Text></Pressable>
      {!native?.provision && <Text accessibilityRole="alert" style={ui.body}>Secure current-device enrollment is unavailable in this build. Use a verified iOS staging build containing the Packet Tunnel extension. Android enrollment requires its existing native device proof; contact staging support. No fallback collector will start.</Text>}
    </Card>
    <Card>
      <Text style={ui.h2}>Linked devices</Text>
      {!profile ? <Text style={ui.body}>Refresh to load devices.</Text> : profile.unavailable.includes('connected devices') ? <Text accessibilityRole="alert" style={ui.body}>Device service unavailable. Check your connection and refresh.</Text> : profile.devices.length === 0 ? <Text style={ui.body}>No linked devices.</Text> : profile.devices.map(device => <Card key={device.device_id}>
        <Text style={ui.h2}>{device.display_name ?? device.platform ?? 'Device'}</Text>
        <Text style={ui.body}>Device: {device.device_id}</Text>
        <Text style={ui.body}>Collector: {device.collector_status ?? 'unknown'} � Monitoring: {device.monitoring_status ?? 'unavailable'}</Text>
        <Text style={ui.body}>Last observation: {device.last_seen_at ?? 'None verified'}</Text>
        <Pressable accessibilityRole="button" disabled={busy || collectionBusy} style={{minHeight:44,justifyContent:'center'}} onPress={() => Alert.alert('Revoke collection and unlink?', 'Withdraw this build's collection permission and unlink this device. Existing app data and credentials are preserved. Other sharing permissions can be reviewed in Permissions.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Revoke and unlink', style: 'destructive', onPress: () => { void run(() => revokeAndUnlinkDevice(manager, device.device_id, { permissionId: process.env.EXPO_PUBLIC_MONITORING_PERMISSION_ID ?? '' }, native, randomUUID())); } },
        ])}><Text style={ui.label}>REVOKE & UNLINK</Text></Pressable>
      </Card>)}
      <Pressable accessibilityRole="button" disabled={busy || collectionBusy} style={{minHeight:44,justifyContent:'center'}} onPress={() => { void refresh(); }}><Text style={ui.label}>REFRESH DEVICES</Text></Pressable>
    </Card>
    {Platform.OS === 'ios' ? <IosCollectorControls disabled={busy || collectionBusy} /> : <Card><Text style={ui.h2}>Set Up Collection</Text><Text style={ui.body}>Native setup from My Devices is unavailable on this platform. Review existing monitoring controls and Permissions. Collection has not been enabled by this screen.</Text></Card>}
    <Pressable accessibilityRole="button" style={{minHeight:44,justifyContent:'center'}} onPress={() => router.push('/permissions')}><Text style={ui.label}>REVIEW PERMISSIONS</Text></Pressable>
  </Screen>;
}
