import { PropsWithChildren } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
export const colors={bg:'#050505',panel:'#111114',line:'#342118',orange:'#ff6a00',blue:'#16a9ff',text:'#fffaf3',muted:'#b9aaa0',green:'#39d98a',red:'#ff665f'};
type ScreenProps = PropsWithChildren<{ refreshing?: boolean; onRefresh?: () => void }>;
export function Screen({children, refreshing=false, onRefresh}:ScreenProps){return <ScrollView
  style={s.screen}
  contentContainerStyle={s.content}
  refreshControl={onRefresh ? <RefreshControl
    refreshing={refreshing}
    onRefresh={onRefresh}
    colors={[colors.orange]}
    progressBackgroundColor={colors.panel}
    tintColor={colors.orange}
  /> : undefined}
>{children}</ScrollView>}
export function BrandHeader({section}:{section:string}){return <View style={s.header}><View><Text style={s.brand}>KICK'S</Text><Text style={s.company}>A PRODUCT OF DATASTORM INC.</Text></View><View style={s.pill}><View style={s.dot}/><Text style={s.pillText}>LIVE BETA</Text></View><Text style={s.section}>{section}</Text></View>}
export function LegacyKicksTransitionMark({size=16}:{size?:number}){return <View
  accessibilityRole="image"
  accessibilityLabel="Former KICK'S product wordmark"
  style={s.legacyMark}
>
  <Text style={[s.legacyWord,{fontSize:size}]}>KICK</Text>
  <View style={s.legacyBacks}>
    <Text style={[s.legacyWord,{fontSize:size}]}>BACKS</Text>
    <View style={[s.legacyStrike,{transform:[{rotate:'18deg'}]}]}/>
    <View style={[s.legacyStrike,{transform:[{rotate:'-18deg'}]}]}/>
  </View>
</View>}
export function MascotHero(){return <View style={s.hero}><Image source={require('../assets/kicks-mascot.png')} resizeMode="cover" style={s.mascot}/><View style={s.heroShade}/><View style={s.heroCopy}><Text style={s.kicker}>YOUR DATA. YOUR DECISION.</Text><Text style={s.heroTitle}>See the signal.{'\n'}Own the value.</Text><Text style={s.heroText}>KICK'S turns hidden app connections into understandable privacy choices and verified compensated opportunities.</Text></View></View>}
export function Card({children,accent=false}:PropsWithChildren<{accent?:boolean}>){return <View style={[s.card,accent&&s.cardAccent]}>{children}</View>}
export const ui=StyleSheet.create({title:{color:colors.text,fontSize:30,fontWeight:'900',letterSpacing:-1},eyebrow:{color:colors.orange,fontSize:11,fontWeight:'900',letterSpacing:1.4},h2:{color:colors.text,fontSize:20,fontWeight:'800'},body:{color:colors.muted,fontSize:14,lineHeight:21},label:{color:'#806f65',fontSize:11,fontWeight:'800',letterSpacing:1},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},orange:{color:colors.orange},green:{color:colors.green},blue:{color:colors.blue}});
const s=StyleSheet.create({
 screen:{flex:1,backgroundColor:colors.bg},content:{padding:18,paddingBottom:42,gap:14},
 header:{borderBottomWidth:1,borderBottomColor:colors.line,paddingBottom:14,marginBottom:2},brand:{color:colors.text,fontSize:24,fontWeight:'900',letterSpacing:2.5},company:{color:colors.orange,fontSize:9,fontWeight:'800',letterSpacing:1.2,marginTop:2},section:{color:colors.muted,fontSize:13,marginTop:12},
 pill:{position:'absolute',right:0,top:3,flexDirection:'row',gap:6,alignItems:'center',borderWidth:1,borderColor:'#4b2b19',backgroundColor:'#1a100b',borderRadius:99,paddingHorizontal:9,paddingVertical:6},dot:{width:6,height:6,borderRadius:3,backgroundColor:colors.green},pillText:{color:'#bff3d7',fontSize:9,fontWeight:'800'},
 legacyMark:{flexDirection:'row',alignItems:'center'},legacyWord:{color:colors.text,fontWeight:'900',letterSpacing:1.6},legacyBacks:{position:'relative'},
 legacyStrike:{position:'absolute',left:-3,right:-3,top:'48%',height:2,backgroundColor:'#ff2d2d',borderRadius:2},
 hero:{height:360,borderRadius:22,overflow:'hidden',borderWidth:1,borderColor:'#5a2c12',backgroundColor:'#120803'},mascot:{position:'absolute',width:'100%',height:'100%'},heroShade:{position:'absolute',left:0,right:0,top:0,bottom:0,backgroundColor:'rgba(0,0,0,.48)'},heroCopy:{position:'absolute',left:20,right:20,bottom:20},
 kicker:{color:colors.orange,fontSize:11,fontWeight:'900',letterSpacing:1.3},heroTitle:{color:colors.text,fontSize:36,lineHeight:39,fontWeight:'900',letterSpacing:-1.2,marginTop:6},heroText:{color:'#f6d7c3',fontSize:14,lineHeight:20,marginTop:8,maxWidth:470},
 card:{backgroundColor:colors.panel,borderWidth:1,borderColor:'#282329',borderRadius:18,padding:17,gap:8},cardAccent:{borderColor:'#693214',backgroundColor:'#160c07'}
});
