import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, colors, ui } from './Brand';
import { useSession } from './SessionProvider';
import { useMonitoringPolicy } from './useMonitoringPolicy';
import { createWebRequestGuard, shouldResetWebReview, webMonitoringContextKey, webMonitoringState, WEB_MONITORING_STATES } from '../services/webMonitoringState.mjs';

type OwnedDevice = {
  device_id: string;
  display_name?: string | null;
  platform?: string | null;
  collector_status?: string | null;
  monitoring_status?: string | null;
};
type SavedConsent = { action?: string; purpose?: string; permissionId?: string; policyVersion?: string; purposeVersion?: string } | null;

const stateCopy: Record<string, string> = {
  [WEB_MONITORING_STATES.sign_in_required]: 'Sign in to review an owned device.',
  [WEB_MONITORING_STATES.policy_unavailable]: 'The reviewed monitoring policy is unavailable. Monitoring is not confirmed.',
  [WEB_MONITORING_STATES.not_connected]: 'No owned device is connected to this account. Monitoring is not connected.',
  [WEB_MONITORING_STATES.fresh_review_required]: 'Fresh consent review is required before every Start or Restart.',
  [WEB_MONITORING_STATES.browser_control_unavailable]: 'Browser Start/Stop is unavailable: no authenticated browser-to-device command channel exists.',
};

export function WebMonitoringControls() {
  const { manager, ready, user } = useSession();
  const { policy, configured, error: policyError, retry } = useMonitoringPolicy();
  const [devices, setDevices] = useState<OwnedDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [consent, setConsent] = useState<SavedConsent>(null);
  const [freshReview, setFreshReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousContext = useRef('');
  const requestGuard = useRef(createWebRequestGuard());
  const deviceIdRef = useRef('');
  const busyRef = useRef(false);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const sessionGeneration = manager.sessionGeneration;
  const requestContext = (selectedDevice = deviceIdRef.current) => ({
    sessionGeneration: manager.sessionGeneration,
    accountSubjectId: manager.user?.subjectId ?? null,
    deviceId: selectedDevice || null,
    policy: policyRef.current,
  });

  const contextKey = useMemo(() => webMonitoringContextKey({
    sessionGeneration,
    accountSubjectId: user?.subjectId,
    deviceId,
    policy,
  }), [sessionGeneration, user?.subjectId, deviceId, policy.permissionId, policy.policyVersion, policy.purposeVersion, policy.purpose]);
  useEffect(() => {
    if (shouldResetWebReview(previousContext.current, contextKey)) setFreshReview(false);
    previousContext.current = contextKey;
  }, [contextKey]);

  useEffect(() => {
    let live = true;
    deviceIdRef.current = '';
    setFreshReview(false); setConsent(null); setDevices([]); setDeviceId(''); setError(null);
    const initialRequest = requestGuard.current.begin(requestContext(''));
    let activeRequest = initialRequest;
    const isCurrent = (request: typeof initialRequest) => live && requestGuard.current.isCurrent(request, requestContext());
    if (!ready || !user) { setLoading(false); return () => { live = false; requestGuard.current.invalidate(); }; }
    setLoading(true);
    void (async () => {
      try {
        const response = await manager.request('/core/consumer/v1/devices');
        if (!isCurrent(initialRequest)) return;
        if (!response.ok) throw new Error('Owned devices could not be confirmed.');
        const result = await response.json();
        if (!isCurrent(initialRequest)) return;
        const list: OwnedDevice[] = Array.isArray(result.devices) ? result.devices : [];
        setDevices(list);
        const selected = list[0]?.device_id ?? '';
        deviceIdRef.current = selected;
        setDeviceId(selected);
        if (selected && configured) {
          activeRequest = requestGuard.current.snapshot(requestContext(selected), initialRequest.nonce);
          const consentResponse = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(selected) + '/consent?permissionId=' + encodeURIComponent(policyRef.current.permissionId));
          if (!isCurrent(activeRequest)) return;
          if (!consentResponse.ok) throw new Error('Saved permission could not be confirmed.');
          const body = await consentResponse.json();
          if (!isCurrent(activeRequest)) return;
          setConsent(body.consent ?? null);
        }
      } catch (failure) {
        if (isCurrent(activeRequest)) setError(failure instanceof Error ? failure.message : 'Owned device state is unknown.');
      } finally { if (isCurrent(activeRequest)) setLoading(false); }
    })();
    return () => { live = false; requestGuard.current.invalidate(); };
  }, [ready, user?.subjectId, sessionGeneration, configured, policy.permissionId, policy.policyVersion, policy.purposeVersion, policy.purpose]);

  useEffect(() => () => { requestGuard.current.cleanup(); }, []);

  const selectDevice = async (id: string) => {
    if (busyRef.current || id === deviceIdRef.current) return;
    deviceIdRef.current = id;
    setDeviceId(id); setFreshReview(false); setConsent(null); setError(null);
    const request = requestGuard.current.begin(requestContext(id));
    const isCurrent = () => requestGuard.current.isCurrent(request, requestContext(id));
    if (!configured) return;
    busyRef.current = true; setBusy(true);
    try {
      const response = await manager.request('/core/consumer/v1/devices/' + encodeURIComponent(id) + '/consent?permissionId=' + encodeURIComponent(policyRef.current.permissionId));
      if (!isCurrent()) return;
      if (!response.ok) throw new Error('Saved permission could not be confirmed.');
      const body = await response.json();
      if (!isCurrent()) return;
      setConsent(body.consent ?? null);
    } catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : 'Selected device state is unknown.'); }
    finally { if (isCurrent()) { busyRef.current = false; setBusy(false); } }
  };

  const accountSubjectId = user?.subjectId ?? null;
  const currentState = error ? 'unknown' : webMonitoringState({
    accountSubjectId,
    deviceId,
    policyConfigured: configured,
    freshReview,
    browserCommandAvailable: false,
  });
  const selected = devices.find(device => device.device_id === deviceId);
  const savedDecision = consent?.action === 'grant' ? 'Permission granted' : consent?.action ? `Saved permission: ${consent.action}` : 'No saved grant confirmed';

  return <Card accent>
    <Text style={ui.eyebrow}>BROWSER REVIEW ONLY</Text>
    <Text style={ui.h2}>Network monitoring consent</Text>
    <Text style={ui.body}>Review the DataStorm-owned device and current policy before any future Start or Restart. This web screen does not control a device or start collection.</Text>
    {!ready ? <ActivityIndicator color={colors.orange} /> : !user ? <Text style={ui.body}>{stateCopy[WEB_MONITORING_STATES.sign_in_required]}</Text> : <>
      {policyError && <View style={s.notice}><Text accessibilityRole="alert" style={ui.body}>{policyError}</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={ui.label}>RETRY POLICY REVIEW</Text></Pressable></View>}
      {loading ? <ActivityIndicator color={colors.orange} /> : <>
        <Text style={ui.label}>OWNED DEVICE</Text>
        {!devices.length ? <Text style={ui.body}>{stateCopy[WEB_MONITORING_STATES.not_connected]}</Text> : <View style={s.deviceList}>
          {devices.map(device => <Pressable accessibilityRole="button" key={device.device_id} disabled={busy} onPress={() => { void selectDevice(device.device_id); }} style={[s.deviceChoice, device.device_id === deviceId && s.deviceChoiceSelected]}>
            <Text style={s.deviceName}>{device.display_name || device.platform || 'Owned device'}</Text>
            <Text style={s.deviceDetail}>{device.platform || 'platform unknown'}{device.device_id === deviceId ? ' · selected' : ''}</Text>
          </Pressable>)}
        </View>}
        {deviceId && <>
          <View style={s.policyBox}>
            <Text style={ui.label}>REVIEWED PURPOSE</Text>
            <Text style={ui.body}>{configured ? policy.purpose : stateCopy[WEB_MONITORING_STATES.policy_unavailable]}</Text>
            {configured && <Text style={s.meta}>Policy {policy.policyVersion} · purpose {policy.purposeVersion} · {savedDecision}</Text>}
          </View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: freshReview, disabled: !configured || busy }} disabled={!configured || busy} onPress={() => setFreshReview(value => !value)} style={s.checkboxRow}>
            <View style={[s.checkbox, freshReview && s.checkboxChecked]}><Text style={s.checkboxMark}>{freshReview ? '✓' : ''}</Text></View>
            <Text style={s.checkboxText}>I freshly reviewed this purpose and device for the next Start or Restart.</Text>
          </Pressable>
          <Text style={s.reviewState}>{stateCopy[currentState] ?? 'Monitoring state is unknown.'}</Text>
          {freshReview && <Text style={ui.body}>Fresh review is recorded locally for this session only. It does not grant permission, start collection, or change the saved decision.</Text>}
          <View style={s.unavailableBox}>
            <Text style={ui.label}>DEVICE CONTROL UNAVAILABLE</Text>
            <Text style={ui.body}>No authenticated browser-to-device command channel exists. Start and Stop are intentionally not dispatched here; no fake off/connected state is shown.</Text>
            {selected && (selected.monitoring_status || selected.collector_status) && <Text style={s.meta}>Account record: {selected.monitoring_status || selected.collector_status} · not proof of an active browser or native collector.</Text>}
          </View>
        </>}
      </>}
    </>}
    {error && <Text accessibilityRole="alert" style={ui.body}>{error}</Text>}
  </Card>;
}

const s = StyleSheet.create({
  notice: { gap: 6, marginBottom: 8 },
  deviceList: { gap: 6, marginBottom: 8 },
  deviceChoice: { borderWidth: 1, borderColor: '#30262a', borderRadius: 10, padding: 10, backgroundColor: '#121014' },
  deviceChoiceSelected: { borderColor: colors.orange, backgroundColor: '#241309' },
  deviceName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  deviceDetail: { color: colors.muted, fontSize: 11, marginTop: 2 },
  policyBox: { borderTopWidth: 1, borderTopColor: '#30262a', paddingTop: 10, gap: 4 },
  meta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  checkbox: { width: 22, height: 22, borderWidth: 1, borderColor: colors.muted, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.orange, borderColor: colors.orange },
  checkboxMark: { color: '#160b06', fontWeight: '900' },
  checkboxText: { color: colors.text, flex: 1, fontSize: 12, lineHeight: 18 },
  reviewState: { color: colors.orange, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  unavailableBox: { borderWidth: 1, borderColor: '#49362a', borderRadius: 10, padding: 10, gap: 4, marginTop: 4 },
});
