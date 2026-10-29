import { useEffect, useRef, useState } from 'react';
import { Alert, NativeModules, Platform, Pressable, Text } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { selectIosNativeAdapter } from '../services/iosNativeAdapter.mjs';
import { randomUUID } from 'expo-crypto';
import { Card, ui } from './Brand';
import { useSession } from './SessionProvider';
import { activateIosCollector, collectorControlAction, isCompleteCollectorStatus, stopCollectorAndVerify, verifiedCollectorConnection, type BoundCollectorConsent } from '../services/iosCollectorActivation.mjs';
import { useMonitoringPolicy } from './useMonitoringPolicy';

const states: Record<string, string> = {
  off: 'Monitoring is off.', vpn_authorization: 'Waiting for iOS VPN permission.',
  connecting: 'Connecting and verifying this iPad’s authorization.',
  connected_waiting_for_evidence: 'VPN connected. Collection has not been verified.',
  collecting: 'Collection verified.', offline_unknown: 'Collector status is unavailable or incomplete. Collection is not confirmed.', stop_unconfirmed: 'Stop could not be confirmed. Turn off KICK’S VPN in iOS Settings.',
};
export function IosCollectorControls({ disabled = false, onBusyChange }: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const { manager, user } = useSession();
  const { policy, configured, error: policyError, retry } = useMonitoringPolicy();
  const [state, setState] = useState('off');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const startInFlight = useRef(false);
  const stopRequested = useRef(false);
  const runGeneration = useRef(0);
  const mounted = useRef(true);
  const usableNative = selectIosNativeAdapter(Platform.OS,
    Platform.OS === 'ios' ? requireOptionalNativeModule('KicksTunnel') : null,
    NativeModules.KicksTunnel);
  const readConsent = async (deviceId: string): Promise<BoundCollectorConsent | null> => {
    const subjectId = manager.user?.subjectId;
    const generation = manager.sessionGeneration;
    if (!subjectId) throw new Error('Sign in before reviewing permission.');
    // The account API verifies ownership of this device. Collector subjects stay server-side.
    const devicesResponse = await manager.request('/core/consumer/v1/devices');
    if (!devicesResponse.ok) throw new Error('This iPad’s account enrollment could not be verified.');
    const devices = await devicesResponse.json();
    if (manager.user?.subjectId !== subjectId || manager.sessionGeneration !== generation) throw new Error('Your account changed. Try again.');
    if (!Array.isArray(devices.devices) || !devices.devices.some((device: {device_id?: string; subject_id?: string; platform?: string; status?: string}) =>
      device.device_id === deviceId && device.subject_id === subjectId && device.platform === 'ios' && device.status === 'active')) {
      throw new Error('This iPad must be enrolled with your account before monitoring starts.');
    }
    const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(deviceId) + '/consent?permissionId=' + encodeURIComponent(policy.permissionId));
    if (!response.ok) throw new Error('Consent could not be verified. Monitoring remains off.');
    const result = await response.json();
    if (manager.user?.subjectId !== subjectId || manager.sessionGeneration !== generation) throw new Error('Your account changed. Try again.');
    return result.consent ? { ...result.consent, deviceId, subjectId } : null;
  };
  const stop = async () => {
    if (!usableNative) { setState('offline_unknown'); setError('The native collector is unavailable; stop state cannot be confirmed.'); return; }
    await stopCollectorAndVerify(usableNative);
    if (mounted.current) setState('off');
  };
  const stopFromControl = async () => {
    // Parent disabled state blocks a new Start but never blocks cancellation or Stop.
    if (startInFlight.current) {
      stopRequested.current = true;
      runGeneration.current += 1;
      if (mounted.current) { setState('connecting'); setError('Stop requested; canceling collector start.'); }
      return;
    }
    if (flight.current) return;
    if (disabled && state === 'off') return;
    stopRequested.current = true;
    runGeneration.current += 1;
    flight.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    try { await stop(); }
    catch { if (mounted.current) { setState('stop_unconfirmed'); setError('Turn off KICK’S VPN in iOS Settings.'); } }
    finally { flight.current = false; onBusyChange?.(false); if (mounted.current) setBusy(false); }
  };
  const start = async () => {
    if (flight.current || disabled || state !== 'off') return;
    flight.current = true; startInFlight.current = true; stopRequested.current = false; const startRun = ++runGeneration.current; setBusy(true); onBusyChange?.(true); setError(null);
    try {
      const subjectId = manager.user?.subjectId;
      const generation = manager.sessionGeneration;
      if (!configured) throw new Error('The reviewed collection purpose is not configured for this build. Monitoring remains off.');
      const result = await activateIosCollector({
        subject: () => mounted.current && manager.sessionGeneration === generation && manager.user?.subjectId === subjectId ? subjectId ?? null : null,
        isCanceled: () => stopRequested.current || runGeneration.current !== startRun,
        policy, native: usableNative,
        provision: usableNative?.provision ? async () => {
          await manager.provisionIosCollector({ provision: usableNative.provision!.bind(usableNative) });
        } : undefined,
        renewLease: usableNative?.renewLease ? async () => {
          await manager.renewIosCollectorLease({ renewLease: usableNative.renewLease!.bind(usableNative) }, policy.permissionId);
        } : undefined,
        disclose: () => new Promise<boolean>(resolve => Alert.alert(
          'Allow KICK’S network monitoring?',
          'Purpose: ' + policy.purpose + '\n\nMonitoring is limited to the reviewed metadata categories. No message or payload contents are authorized. This consent does not authorize commercial sharing or compensated studies.\n\nEach Start or Restart requires this fresh consent submission; a previous saved grant is never reused. You can stop monitoring or revoke consent in Permissions. Continuing enrolls this iPad with your account, submits a new activation, and requests a short-lived gateway authorization before asking iOS for separate VPN permission.',
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Continue', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) })),
        readConsent,
        newActivationRequestId: () => randomUUID(),
        grantConsent: async (deviceId, activationRequestId) => {
          const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(deviceId) + '/consent', {
            method: 'POST', headers: {'content-type':'application/json'},
            body: JSON.stringify({ ...policy, action: 'grant', activationRequestId }),
          });
          if (!response.ok) throw new Error('Consent was not confirmed. Monitoring remains off.');
        },
        onState: value => { if (mounted.current) setState(value); },
      });
      if (mounted.current) setState(result.state);
    } catch (failure) {
      if (mounted.current) {
        const message = failure instanceof Error ? failure.message : 'Collector activation failed.';
        setError(message); setState(message.includes('stop could not be confirmed') ? 'stop_unconfirmed' : /unavailable|incomplete|unknown/i.test(message) ? 'offline_unknown' : 'off');
      }
    } finally { startInFlight.current = false; flight.current = false; onBusyChange?.(false); if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (usableNative) {
      setState('checking');
      void usableNative.getStatus().then(status => {
        if (!mounted.current) return;
        if (!isCompleteCollectorStatus(status)) {
          setState('offline_unknown'); setError(status?.unavailableReason ?? 'Existing collector status is unavailable or incomplete.'); return;
        }
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
    const generation = manager.sessionGeneration;
    const verify = async () => {
      if (checking || !live || flight.current) return;
      checking = true;
      try {
        const deviceId = await usableNative.getDeviceId();
        const consent = await readConsent(deviceId);
        if (!consent || consent.action !== 'grant' || consent.permissionId !== policy.permissionId ||
            consent.purpose !== policy.purpose || consent.policyVersion !== policy.policyVersion || consent.purposeVersion !== policy.purposeVersion) {
          throw new Error('Monitoring permission is no longer active.');
        }
        let status = await usableNative.getStatus();
        if (verifiedCollectorConnection(status, consent) && Date.parse(status.expiresAt ?? '') - Date.now() <= 60_000) {
          await manager.renewIosCollectorLease({ renewLease: usableNative.renewLease!.bind(usableNative) }, policy.permissionId);
          status = await usableNative.getStatus();
        }
        if (manager.sessionGeneration !== generation || !verifiedCollectorConnection(status, consent)) {
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
  }, [user?.subjectId, manager.sessionGeneration, state, policy.permissionId, policy.policyVersion, policy.purposeVersion, policy.purpose]);
  const stopAvailable = startInFlight.current || state !== 'off';
  const buttonDisabled = (disabled && !stopAvailable) || (!usableNative && !stopAvailable) || (state === 'off' && !configured && !stopAvailable);
  const buttonLabel = startInFlight.current ? 'STOP MONITORING' : busy ? 'STOPPING…' : state === 'off' ? 'SET UP COLLECTION' : 'STOP MONITORING';
  return <Card accent>
    <Text style={ui.h2}>Set Up Collection</Text>
    {policyError && <><Text accessibilityRole="alert" style={ui.body}>{policyError}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={retry}><Text style={ui.label}>RETRY COLLECTION SETUP</Text></Pressable></>}
    {!usableNative && <Text accessibilityRole="alert" style={ui.body}>The native extension is unavailable. Install a verified staging build containing the signed Packet Tunnel extension, then retry. No fallback collection is enabled.</Text>}
    <Text accessibilityRole="alert" style={ui.body}>{states[state] ?? 'Checking collector status.'}</Text>
    <Pressable accessibilityRole="button" disabled={buttonDisabled} style={{minHeight:44,justifyContent:'center'}} onPress={() => {
      if (collectorControlAction(state, startInFlight.current) === 'stop') void stopFromControl();
      else void start();
    }}><Text style={ui.label}>{buttonLabel}</Text></Pressable>
    {error && <Text accessibilityRole="alert" style={ui.body}>{error}</Text>}
    <Text style={ui.body}>Stopping the VPN and revoking saved consent are separate controls. Review or withdraw your permission on the Permissions screen.</Text>
  </Card>;
}

