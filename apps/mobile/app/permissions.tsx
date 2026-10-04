import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { LiveEngineSnapshotCore, loadLiveEngineSnapshot } from '../components/live-engine';

type PermissionSnapshot = LiveEngineSnapshotCore;

export default function Permissions() {
  const [snapshot, setSnapshot] = useState<PermissionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    loadLiveEngineSnapshot<PermissionSnapshot>({ force: true })
      .then(value => { if (mounted) { setSnapshot(value); setError(null); } })
      .catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : 'Unable to load consent evidence.'); });
    return () => { mounted = false; };
  }, []));

  const status = snapshot?.consent.status ?? 'missing';
  return <Screen>
    <BrandHeader section="Permission control" />
    <Text style={ui.eyebrow}>CONSENT EVIDENCE</Text>
    <Text style={ui.title}>Control each use.</Text>
    <Text style={ui.body}>Monitoring consent and commercial consent are separate. KICK’S does not convert one permission into another.</Text>

    <Card accent>
      <View style={ui.row}>
        <View style={s.flex}>
          <Text style={ui.eyebrow}>MONITORING PERMISSION</Text>
          <Text style={ui.h2}>{status === 'active' ? 'Active and ledger-linked.' : status === 'inactive' ? 'Inactive.' : 'No active grant.'}</Text>
        </View>
        <Text style={status === 'active' ? s.active : s.inactive}>{status.toUpperCase()}</Text>
      </View>
      <Text style={ui.body}>{snapshot?.consent.purpose ?? 'A fresh monitoring grant is created only when you explicitly turn monitoring on.'}</Text>
      <Text style={s.evidence}>Permission ID · {snapshot?.consent.permissionId ?? 'none'}</Text>
      {error && <Text style={s.error}>{error}</Text>}
    </Card>

    <Card>
      <Text style={ui.eyebrow}>COMMERCIAL PERMISSION</Text>
      <Text style={ui.h2}>No inferred sharing.</Text>
      <Text style={ui.body}>A compensated opportunity must identify the data category, purpose, recipient or buyer class, duration, terms, and compensation before a commercial grant can be created.</Text>
      <Text style={s.boundary}>Monitoring permission never becomes commercial permission automatically.</Text>
    </Card>

    <Card>
      <Text style={ui.eyebrow}>CONSENT LIFECYCLE</Text>
      <PermissionLine title="Grant" detail="A new decision creates a new consent event tied to the current device and purpose." />
      <PermissionLine title="Use" detail="The Engine accepts monitoring data only when the active permission matches the device and purpose." />
      <PermissionLine title="Stop" detail="Turning monitoring off ends the current activation and revokes its monitoring grant." />
      <PermissionLine title="Restart" detail="A later restart requires another fresh consumer decision. There is no silent resume." />
    </Card>
  </Screen>;
}

function PermissionLine({ title, detail }: { title: string; detail: string }) {
  return <View style={s.line}><View style={s.dot}/><View style={s.flex}><Text style={s.lineTitle}>{title}</Text><Text style={s.lineDetail}>{detail}</Text></View></View>;
}
const s=StyleSheet.create({flex:{flex:1},active:{color:colors.green,fontSize:10,fontWeight:'900'},inactive:{color:colors.orange,fontSize:10,fontWeight:'900'},evidence:{color:'#80736b',fontSize:10,fontFamily:'monospace'},error:{color:colors.red,fontSize:11,lineHeight:16},line:{flexDirection:'row',gap:10,borderTopWidth:1,borderTopColor:'#30241f',paddingTop:11},dot:{width:7,height:7,borderRadius:4,backgroundColor:colors.orange,marginTop:5},lineTitle:{color:colors.text,fontSize:13,fontWeight:'900'},lineDetail:{color:colors.muted,fontSize:11,lineHeight:17,marginTop:3},boundary:{color:colors.orange,fontSize:10,lineHeight:15,fontWeight:'800'}});
