import { useEffect, useRef, useState } from 'react';
import { Alert, NativeModules, Platform, Pressable, Text } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { selectIosNativeAdapter } from '../services/iosNativeAdapter.mjs';
import { randomUUID } from 'expo-crypto';
import { Card, ui } from './Brand';
import { useSession } from './SessionProvider';
import { activateIosCollector, type BoundCollectorConsent } from '../services/iosCollectorActivation.mjs';

const policy = {
  permissionId: process.env.EXPO_PUBLIC_MONITORING_PERMISSION_ID ?? '',
  policyVersion: process.env.EXPO_PUBLIC_MONITORING_POLICY_VERSION ?? '',
  purposeVersion: process.env.EXPO_PUBLIC_MONITORING_PURPOSE_VERSION ?? '',
  purpose: process.env.EXPO_PUBLIC_MONITORING_PURPOSE ?? '',
};
const configured = Object.values(policy).every(Boolean);
const states: Record<string, string> = {
  off: 'Monitoring is off.', vpn_authorization: 'Waiting for iOS VPN permission.',
  connected_waiting_for_evidence: 'VPN connected. Collection has not been verified.',
  collecting: 'Collection verified.', stop_unconfirmed: 'Stop could not be confirmed. Turn off KICK’S VPN in iOS Settings.',
};
export function IosCollectorControls() {
  const { manager, user } = useSession();
  const [state, setState] = useState('off');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const mounted = useRef(true);
  const usableNative = selectIosNativeAdapter(Platform.OS,
    Platform.OS === 'ios' ? requireOptionalNativeModule('KicksTunnel') : null,
    NativeModules.KicksTunnel);
  const readConsent = async (deviceId: string): Promise<BoundCollectorConsent | null> => {
    const subjectId = manager.user?.subjectId;
    if (!subjectId) throw new Error('Sign in before reviewing permission.');
    // The account API verifies ownership of this device. Collector subjects stay server-side.
    const devicesResponse = await manager.request('/core/consumer/v1/devices');
    if (!devicesResponse.ok) throw new Error('This iPad’s account enrollment could not be verified.');
    const devices = await devicesResponse.json();
    if (!Array.isArray(devices.devices) || !devices.devices.some((device: {device_id?: string; platform?: string; status?: string}) =>
      device.device_id === deviceId && device.platform === 'ios' && device.status === 'active')) {
      throw new Error('This iPad must be enrolled with your account before monitoring starts.');
    }
    const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(deviceId) + '/consent?permissionId=' + encodeURIComponent(policy.permissionId));
    if (!response.ok) throw new Error('Consent could not be verified. Monitoring remains off.');
    const result = await response.json();
    if (manager.user?.subjectId !== subjectId) throw new Error('Your account changed. Try again.');
    return result.consent ? { ...result.consent, deviceId, subjectId } : null;
  };
  const stop = async () => {
    if (!usableNative) { setState('off'); return; }
    await usableNative.stop();
    const status = await usableNative.getStatus();
    if (status.connected === true || status.collecting === true) throw new Error('Collector stop could not be confirmed. Turn off KICK’S VPN in iOS Settings.');
    if (mounted.current) setState('off');
  };
  const start = async () => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(null);
    try {
      if (!configured) throw new Error('The reviewed collection purpose is not configured for this build. Monitoring remains off.');
      const result = await activateIosCollector({
        subject: () => mounted.current ? manager.user?.subjectId ?? null : null, policy, native: usableNative,
        disclose: () => new Promise<boolean>(resolve => Alert.alert(
          'Allow KICK’S network monitoring?',
          'Purpose: ' + policy.purpose + '\n\nMonitoring is limited to the reviewed metadata categories. No message or payload contents are authorized. This consent does not authorize commercial sharing or compensated studies.\n\nYou can stop monitoring or revoke consent in Permissions. Continuing saves this device’s consent if needed, then asks iOS for separate VPN permission.',
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Continue', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) })),
        readConsent,
        grantConsent: async deviceId => {
          const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(deviceId) + '/consent', {
            method: 'POST', headers: {'content-type':'application/json'},
            body: JSON.stringify({ ...policy, action: 'grant', activationRequestId: randomUUID() }),
          });
          if (!response.ok) throw new Error('Consent was not confirmed. Monitoring remains off.');
        },
        onState: value => { if (mounted.current) setState(value); },
      });
      if (mounted.current) setState(result.state);
    } catch (failure) {
      if (mounted.current) {
        const message = failure instanceof Error ? failure.message : 'Collector activation failed.';
        setError(message); setState(message.includes('stop could not be confirmed') ? 'stop_unconfirmed' : 'off');
      }
    } finally { flight.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (usableNative) {
      setState('checking');
      void usableNative.getStatus().then(status => {
        if (!mounted.current) return;
        setState(status.connected === true || status.collecting === true ? 'connected_waiting_for_evidence' : 'off');
      }).catch(() => {
        if (mounted.current) { setState('stop_unconfirmed'); setError('Existing VPN status could not be confirmed. Check KICK’S VPN in iOS Settings.'); }
      });
    }
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!usableNative || !['collecting', 'connected_waiting_for_evidence'].includes(state)) return;
    let checking = false; let live = true;
    const verify = async () => {
      if (checking || !live) return;
      checking = true;
      try {
        const deviceId = await usableNative.getDeviceId();
        const consent = await readConsent(deviceId);
        if (!consent || consent.action !== 'grant' || consent.permissionId !== policy.permissionId ||
            consent.purpose !== policy.purpose || consent.policyVersion !== policy.policyVersion || consent.purposeVersion !== policy.purposeVersion) {
          throw new Error('Monitoring permission is no longer active.');
        }
        const status = await usableNative.getStatus();
        if (status.connected !== true || status.consentVerified !== true || status.deviceId !== deviceId || status.permissionId !== policy.permissionId) {
          throw new Error('Collector authorization could not be verified.');
        }
        const accepted = Date.parse(status.lastAcceptedObservationAt ?? '');
        if (live) setState(status.collecting && Number.isFinite(accepted) && accepted > Date.now() - 30_000 && accepted <= Date.now() + 5000 ? 'collecting' : 'connected_waiting_for_evidence');
      } catch (failure) {
        try { await stop(); } catch { if (live) setState('stop_unconfirmed'); }
        if (live) setError(failure instanceof Error ? failure.message : 'Monitoring was stopped.');
      } finally { checking = false; }
    };
    void verify();
    const interval = setInterval(() => { void verify(); }, 15_000);
    return () => { live = false; clearInterval(interval); };
  }, [user?.subjectId, state]);
  return <Card accent>
    <Text style={ui.h2}>Network monitoring</Text>
    <Text accessibilityRole="alert" style={ui.body}>{states[state] ?? 'Checking collector status.'}</Text>
    <Pressable accessibilityRole="button" disabled={busy || state === 'checking'} style={{minHeight:44,justifyContent:'center'}} onPress={() => {
      if (['collecting', 'connected_waiting_for_evidence', 'stop_unconfirmed'].includes(state)) {
        void stop().catch(() => { setState('stop_unconfirmed'); setError('Turn off KICK’S VPN in iOS Settings.'); });
      } else void start();
    }}><Text style={ui.label}>{busy ? 'CHECKING…' : state === 'off' ? 'START MONITORING' : 'STOP MONITORING'}</Text></Pressable>
    {error && <Text accessibilityRole="alert" style={ui.body}>{error}</Text>}
    <Text style={ui.body}>Stopping the VPN and revoking saved consent are separate controls. Review or withdraw your permission on the Permissions screen.</Text>
  </Card>;
}
