import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import { LiveEngineSnapshotCore, loadLiveEngineSnapshot } from '../components/live-engine';

type Observation = {
  sourceApp?: string | null;
  sourceAppName?: string | null;
  behaviorTier?: 'operational' | 'behavioral' | 'unexpected' | 'unknown';
  valuePotential?: 'not_assessed' | 'emerging' | 'moderate' | 'high';
  buyerCategory?: string | null;
  compensationEligible?: boolean;
  eligibilityReason?: string;
  purpose?: string;
};
type OpportunitySnapshot = Omit<LiveEngineSnapshotCore,'observations'> & { observations: Observation[] };

export default function Opportunities() {
  const [snapshot,setSnapshot]=useState<OpportunitySnapshot|null>(null);
  const [error,setError]=useState<string|null>(null);
  useFocusEffect(useCallback(()=>{let mounted=true;loadLiveEngineSnapshot<OpportunitySnapshot>({force:true}).then(value=>{if(mounted){setSnapshot(value);setError(null);}}).catch(reason=>{if(mounted)setError(reason instanceof Error?reason.message:'Unable to load live opportunity evidence.');});return()=>{mounted=false;};},[]));

  const candidates=useMemo(()=>(snapshot?.observations??[]).filter(item=>item.valuePotential&&item.valuePotential!=='not_assessed'),[snapshot]);
  const verified=useMemo(()=>candidates.filter(item=>item.compensationEligible&&item.buyerCategory),[candidates]);

  return <Screen>
    <BrandHeader section="Compensated data opportunities" />
    <Text style={ui.eyebrow}>ENGINE-VERIFIED MATCHING</Text>
    <Text style={ui.title}>Value with boundaries.</Text>
    <Text style={ui.body}>KICK’S separates potential relevance from an actual compensated offer. No buyer or payment amount is invented when a verified match does not exist.</Text>

    <Card accent>
      <Text style={verified.length>0?s.verified:s.status}>{verified.length>0?`${verified.length} VERIFIED MATCH${verified.length===1?'':'ES'}`:'NO VERIFIED MATCHES YET'}</Text>
      <Text style={ui.h2}>{verified.length>0?'Your Engine found consent-eligible matches.':'Your data remains under your control.'}</Text>
      <Text style={ui.body}>{verified.length>0?'Each match below is derived from the live Engine response and still requires a separate commercial permission before any transfer.':'The Engine may identify potentially relevant patterns, but a buyer, amount, and earning claim remain hidden until they are verified.'}</Text>
      {error&&<Text style={s.error}>{error}</Text>}
    </Card>

    {verified.map((item,index)=><Card key={`${item.buyerCategory}:${index}`}>
      <Text style={ui.eyebrow}>VERIFIED BUYER CATEGORY</Text>
      <Text style={ui.h2}>{item.buyerCategory}</Text>
      <Text style={ui.body}>{item.purpose||'Purpose supplied by the live Engine.'}</Text>
      <Text style={s.verified}>{item.eligibilityReason||'Engine eligibility evidence verified.'}</Text>
    </Card>)}

    {verified.length===0&&candidates.length>0&&<Card>
      <Text style={ui.eyebrow}>POTENTIAL RELEVANCE</Text>
      <Text style={ui.h2}>{candidates.length} pattern{candidates.length===1?'':'s'} under evaluation.</Text>
      <Text style={ui.body}>These patterns are not offers. KICK’S waits for verified buyer pricing, purpose, eligibility, and separate commercial consent.</Text>
    </Card>}

    <View style={s.steps}>
      <Step n="01" text="The live Intelligence Engine identifies a potentially relevant pattern." />
      <Step n="02" text="A reviewed buyer specification must match the category, purpose, and jurisdiction." />
      <Step n="03" text="You review exact terms and provide separate commercial consent." />
      <Step n="04" text="Only a completed, verified reward becomes a consumer-visible ledger entry." />
    </View>
  </Screen>;
}
function Step({n,text}:{n:string;text:string}){return <View style={s.step}><Text style={s.n}>{n}</Text><Text style={s.stepText}>{text}</Text></View>}
const s=StyleSheet.create({status:{color:colors.orange,fontSize:10,fontWeight:'900',letterSpacing:1},verified:{color:colors.green,fontSize:10,fontWeight:'900',letterSpacing:.6},error:{color:colors.red,fontSize:11,lineHeight:16},steps:{gap:8},step:{flexDirection:'row',alignItems:'flex-start',gap:12,backgroundColor:'#101012',borderWidth:1,borderColor:'#282329',padding:14,borderRadius:14},n:{color:colors.orange,fontWeight:'900'},stepText:{color:colors.text,fontWeight:'700',lineHeight:19,flex:1}});
