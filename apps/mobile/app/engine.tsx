import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, NativeModules, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { LiveEngineSnapshotCore, loadLiveEngineSnapshot } from '../components/live-engine';

type ConsentStatus = 'active' | 'inactive' | 'missing';
type BehaviorTier = 'operational' | 'behavioral' | 'unexpected' | 'unknown';
type EngineObservation = {
  observationId: string;
  observedAt?: string;
  lastObservedAt?: string;
  destinationDomain?: string;
  destinationHost?: string;
  sourceApp?: string | null;
  sourceAppName?: string | null;
  company?: string;
  purpose?: string;
  dataCategory?: string;
  commercialFunction?: string;
  behaviorTier?: BehaviorTier;
  plainLanguageSummary?: string;
  behaviorSummary?: string;
  confidence?: number;
  frequency?: number;
  protocol?: string;
  bytesBucket?: string;
  consentStatus?: ConsentStatus;
  consentPurpose?: string;
};
type EngineSnapshot = Omit<LiveEngineSnapshotCore, 'observations'> & {
  observations: EngineObservation[];
};
type KicksVpnBridge = {
  isActive(): Promise<boolean>;
  isProvisioned(): Promise<boolean>;
  getEngineSnapshot(): Promise<string>;
  grantMonitoringConsent(): Promise<string>;
  revokeMonitoringConsent(): Promise<string>;
  requestAuthorization(): Promise<'authorized' | 'authorization_opened' | 'denied'>;
  start(): Promise<string>;
  stop(): Promise<string>;
};

const bridge = NativeModules.KicksVpn as KicksVpnBridge | undefined;
const tierTone: Record<BehaviorTier, string> = {
  operational: '#9b918b',
  behavioral: colors.orange,
  unexpected: colors.red,
  unknown: '#ffcf4a',
};

export default function Engine() {
  const [active, setActive] = useState(false);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'meaningful' | 'all'>('meaningful');
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (showIndicator = true) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (showIndicator) setLoading(true);
    try {
      if (Platform.OS !== 'android' || !bridge) throw new Error('The Android monitoring bridge is unavailable in this build.');
      try { setActive(await bridge.isActive()); } catch {}
      const next = await loadLiveEngineSnapshot<EngineSnapshot>({ force: showIndicator });
      setSnapshot(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the live Engine snapshot.');
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh(true);
    const timer = setInterval(() => void refresh(false), 15_000);
    return () => clearInterval(timer);
  }, [refresh]));

  const visible = useMemo(() => {
    const observations = snapshot?.observations ?? [];
    if (filter === 'all') return observations.slice(0, 30);
    return observations.filter(item => (item.behaviorTier ?? 'unknown') !== 'operational').slice(0, 30);
  }, [filter, snapshot]);

  const toggleMonitoring = async () => {
    if (!bridge || Platform.OS !== 'android') return;
    setToggling(true);
    let freshGrantCreated = false;
    try {
      if (active) {
        await bridge.stop();
        await bridge.revokeMonitoringConsent();
        setActive(false);
      } else {
        if (!(await bridge.isProvisioned())) throw new Error('This device has not been securely provisioned.');
        await bridge.grantMonitoringConsent();
        freshGrantCreated = true;
        const authorization = await bridge.requestAuthorization();
        if (authorization !== 'authorized') {
          await bridge.revokeMonitoringConsent();
          freshGrantCreated = false;
          Alert.alert('Device approval required', 'Approve the Android VPN connection, then turn monitoring on again. A new KICK’S consent grant will be required.');
          return;
        }
        await bridge.start();
        freshGrantCreated = false;
        setActive(true);
      }
      setTimeout(() => void refresh(true), 1_000);
    } catch (reason) {
      if (freshGrantCreated) {
        try { await bridge.revokeMonitoringConsent(); } catch {}
      }
      Alert.alert('Monitoring not changed', reason instanceof Error ? reason.message : 'Unable to change monitoring.');
    } finally {
      setToggling(false);
    }
  };

  return <Screen refreshing={loading && snapshot !== null} onRefresh={() => void refresh(true)}>
    <BrandHeader section="KICK’S Intelligence Engine" />
    <Card accent>
      <View style={ui.row}>
        <View style={s.flex}>
          <Text style={ui.eyebrow}>EXFILTRATION MONITORING</Text>
          <Text style={ui.title}>{active ? 'Monitoring live.' : 'Monitoring paused.'}</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: active, disabled: toggling }}
          disabled={toggling || !bridge}
          onPress={toggleMonitoring}
          style={[s.toggle, active && s.toggleOn]}
        >
          <View style={[s.dot, active && s.dotOn]} />
          <Text style={s.toggleText}>{toggling ? 'Updating' : active ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>
      <Text style={ui.body}>Each OFF → ON transition requires a fresh KICK’S monitoring consent record before Android network authorization and collection can start.</Text>
      <Text style={s.disclosure}>DESTINATION METADATA ONLY · NO MESSAGE OR PAYLOAD CONTENTS</Text>
    </Card>

    <View style={s.metrics}>
      <Metric label="CONNECTIONS · 24H" value={snapshot?.metrics.observations} />
      <Metric label="COMPANY DOMAINS" value={snapshot?.metrics.distinctDomains} />
      <Metric label="IDENTIFIED APPS" value={snapshot?.metrics.attributedApps} />
      <Metric label="REVIEW" value={snapshot?.metrics.review} warning />
    </View>

    <Card>
      <View style={ui.row}>
        <View style={s.flex}>
          <Text style={ui.eyebrow}>CONSENT EVIDENCE GATE</Text>
          <Text style={ui.h2}>{consentTitle(snapshot?.consent.status)}</Text>
        </View>
        <Text style={snapshot?.consent.status === 'active' ? s.good : s.warn}>{snapshot?.consent.status?.toUpperCase() ?? 'CHECKING'}</Text>
      </View>
      <Text style={ui.body}>{snapshot?.consent.purpose ?? 'Waiting for a verified monitoring permission record.'}</Text>
      <Text style={s.micro}>Permission ID · {snapshot?.consent.permissionId ?? 'none'}</Text>
    </Card>

    <View style={ui.row}>
      <View style={s.flex}><Text style={ui.eyebrow}>LIVE INTELLIGENCE</Text><Text style={ui.h2}>App → company → purpose</Text></View>
      <Pressable onPress={() => setFilter(current => current === 'all' ? 'meaningful' : 'all')} style={s.filter}>
        <Text style={s.filterText}>{filter === 'all' ? 'Meaningful only' : 'Show all'}</Text>
      </Pressable>
    </View>

    {error && <Card><Text style={s.error}>Live Engine unavailable</Text><Text style={ui.body}>{error}</Text></Card>}
    {!error && !loading && visible.length === 0 && <Card><Text style={ui.h2}>No live observations yet.</Text><Text style={ui.body}>With monitoring active, use the device normally. Consent-linked app-to-company metadata will appear here as the Engine receives it.</Text></Card>}

    {visible.map((item, index) => <ObservationCard item={item} key={`${item.observationId}:${index}`} />)}

    <Card>
      <Text style={ui.eyebrow}>ENGINE BOUNDARY</Text>
      <Text style={ui.h2}>Evidence, not invented claims.</Text>
      <Text style={ui.body}>KICK’S reports observed destination, timing, frequency, and available app attribution. Purpose and commercial meaning are Engine classifications and remain bounded by the evidence returned with the live observation.</Text>
    </Card>
  </Screen>;
}

function Metric({label,value,warning=false}:{label:string;value?:number;warning?:boolean}) {
  return <View style={s.metric}><Text style={ui.label}>{label}</Text><Text style={[s.metricValue,warning&&ui.orange]}>{value == null ? '—' : value}</Text></View>;
}

function ObservationCard({item}:{item:EngineObservation}) {
  const tier = item.behaviorTier ?? 'unknown';
  const tone = tierTone[tier];
  const app = item.sourceAppName || item.sourceApp || 'App identity pending';
  const company = item.company || item.destinationDomain || item.destinationHost || 'Destination under review';
  return <Card>
    <View style={ui.row}>
      <View style={s.flex}><Text style={s.app}>{app}</Text><Text style={[s.company,{color:tone}]}>→ {company}</Text></View>
      <Text style={[s.tier,{color:tone}]}>{tier.toUpperCase()}</Text>
    </View>
    <Text style={ui.body}>{item.plainLanguageSummary || item.behaviorSummary || `${app} contacted ${company}.`}</Text>
    <View style={s.facts}>
      <Fact label="PURPOSE" value={item.purpose || 'Under review'} />
      <Fact label="DATA" value={item.dataCategory || 'Metadata'} />
      <Fact label="CONFIDENCE" value={item.confidence == null ? 'Not scored' : `${item.confidence}%`} />
      <Fact label="FREQUENCY" value={item.frequency == null ? '—' : String(item.frequency)} />
    </View>
    <Text style={s.micro}>{(item.protocol || 'network').toUpperCase()} · {item.bytesBucket || 'size not reported'} · {formatTime(item.lastObservedAt || item.observedAt)}</Text>
  </Card>;
}

function Fact({label,value}:{label:string;value:string}) { return <View style={s.fact}><Text style={ui.label}>{label}</Text><Text style={s.factValue}>{value}</Text></View>; }
function consentTitle(status?:ConsentStatus){if(status==='active')return 'Verified monitoring permission is active.';if(status==='inactive')return 'Monitoring permission is inactive.';return 'No verified monitoring permission.';}
function formatTime(value?:string){if(!value)return 'No timestamp';const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown time':date.toLocaleString();}

const s=StyleSheet.create({
  flex:{flex:1},toggle:{flexDirection:'row',alignItems:'center',gap:7,borderWidth:1,borderColor:'#493a32',borderRadius:99,paddingHorizontal:11,paddingVertical:8},toggleOn:{borderColor:'#2b7654',backgroundColor:'#0b2118'},dot:{width:7,height:7,borderRadius:4,backgroundColor:'#746a65'},dotOn:{backgroundColor:colors.green},toggleText:{color:colors.text,fontSize:11,fontWeight:'900'},
  disclosure:{color:colors.orange,fontSize:10,fontWeight:'900',letterSpacing:.7},metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},metric:{width:'48%',backgroundColor:colors.panel,borderWidth:1,borderColor:'#282329',borderRadius:16,padding:14},metricValue:{color:colors.text,fontSize:25,fontWeight:'900',marginTop:4},good:{color:colors.green,fontSize:10,fontWeight:'900'},warn:{color:colors.orange,fontSize:10,fontWeight:'900'},micro:{color:'#81736b',fontSize:9,lineHeight:14},filter:{borderWidth:1,borderColor:'#493a32',borderRadius:99,paddingHorizontal:11,paddingVertical:7},filterText:{color:colors.blue,fontSize:10,fontWeight:'900'},error:{color:colors.red,fontSize:17,fontWeight:'900'},app:{color:colors.text,fontSize:16,fontWeight:'900'},company:{fontSize:12,fontWeight:'800',marginTop:3},tier:{fontSize:9,fontWeight:'900'},facts:{flexDirection:'row',flexWrap:'wrap',gap:7},fact:{width:'48%',backgroundColor:'#09090b',borderRadius:10,padding:9,gap:4},factValue:{color:colors.text,fontSize:11,fontWeight:'800'}
});
