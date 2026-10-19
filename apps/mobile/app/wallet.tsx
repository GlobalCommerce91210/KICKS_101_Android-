import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { LiveEngineSnapshotCore, loadLiveEngineSnapshot } from '../components/live-engine';

type Observation = {
  compensationEligible?: boolean;
  buyerCategory?: string | null;
  eligibilityReason?: string;
};
type WalletSnapshot = Omit<LiveEngineSnapshotCore,'observations'> & { observations: Observation[] };

export default function Wallet(){
  const [snapshot,setSnapshot]=useState<WalletSnapshot|null>(null);
  const [error,setError]=useState<string|null>(null);
  useFocusEffect(useCallback(()=>{let mounted=true;loadLiveEngineSnapshot<WalletSnapshot>({force:true}).then(value=>{if(mounted){setSnapshot(value);setError(null);}}).catch(reason=>{if(mounted)setError(reason instanceof Error?reason.message:'Unable to load reward evidence.');});return()=>{mounted=false;};},[]));
  const eligible=useMemo(()=>(snapshot?.observations??[]).filter(item=>item.compensationEligible&&item.buyerCategory),[snapshot]);

  return <Screen>
    <BrandHeader section="Rewards ledger" />
    <View style={s.hero}>
      <Text style={ui.label}>VERIFIED REWARDS</Text>
      <Text style={s.balance}>—</Text>
      <Text style={ui.body}>KICK’S does not display a balance until completed reward receipts are returned by the settlement ledger.</Text>
      <View style={s.line}/>
      <View style={ui.row}><Text style={s.small}>Engine-eligible patterns</Text><Text style={s.smallValue}>{eligible.length}</Text></View>
    </View>

    {error&&<Card><Text style={s.error}>Reward evidence unavailable</Text><Text style={ui.body}>{error}</Text></Card>}

    <Text style={ui.eyebrow}>TRANSACTION HISTORY</Text>
    <Card>
      <Text style={ui.h2}>No verified reward receipts loaded.</Text>
      <Text style={ui.body}>A consumer-visible transaction will appear only after a verified opportunity, separate commercial consent, completed delivery, settlement event, and immutable receipt are available.</Text>
    </Card>

    <Card>
      <Text style={ui.eyebrow}>LEDGER STANDARD</Text>
      <Text style={ui.body}>Potential value is not a balance. KICK’S will not use simulated earnings, fallback dollar amounts, or synthetic payout history in this build.</Text>
    </Card>
  </Screen>;
}
const s=StyleSheet.create({hero:{backgroundColor:'#190d07',borderRadius:22,padding:24,gap:7,borderWidth:1,borderColor:'#693214'},balance:{color:colors.orange,fontSize:46,fontWeight:'900'},line:{height:1,backgroundColor:'#4d2b1a',marginVertical:8},small:{color:'#b99a88'},smallValue:{color:colors.text,fontWeight:'800'},error:{color:colors.red,fontSize:16,fontWeight:'900'}});
