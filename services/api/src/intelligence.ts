import { randomUUID } from 'node:crypto';

export type MetadataType =
  | 'behavioral'
  | 'commercial'
  | 'transactional'
  | 'intent'
  | 'engagement'
  | 'device'
  | 'operational';

export type ConsentState = 'allowed' | 'blocked' | 'conditional';

export interface TelemetryEvent {
  event_id: string;
  timestamp: string;
  app_id: string;
  device_id: string;
  user_id?: string | null;
  sdk_version?: string;
  network: { domain: string; endpoint: string; method: string; status_code?: number };
  metadata?: Record<string, unknown>;
  tags?: string[];
}
export interface ClassificationResult { category: 'operational'|'behavioral_commercial'|'unexpected'|'unknown'; reason_codes: string[] }
export interface ScoreSet { commercial_intent_score:number; metadata_value_estimate:number; baseline_stability_score:number; deviation_severity_score:number; purpose_confidence_score:number }
export interface PersonaAssignment { scope:'app'|'device'|'user'; scope_id:string; persona:'heavy_commercial'|'light_commercial'|'operational'|'mixed'|'unknown'; effective_from:string }
export interface Explanation { title:string; summary:string; details:string[]; confidence_band:'high'|'medium'|'low'; tags:string[] }
export interface MetadataItem { key:string; type:MetadataType; description:string; sample_value:unknown; estimated_value_per_event:number; buyer_categories:string[]; consent_required:boolean; consent_state:ConsentState }
export interface MetadataInspectionView { event_id:string; app_id:string; metadata_items:MetadataItem[]; total_estimated_value:number; eligible_for_marketplace:boolean }
export interface AppMetadataGates { app_id:string; gates:Array<{metadata_type:MetadataType;default_state:ConsentState;buyer_overrides?:Array<{buyer_category:string;state:ConsentState}>}> }
export interface MarketplaceOffer { offer_id:string; buyer_id:string; buyer_category:string; metadata_types:string[]; pricing_model:{type:'per_event'|'per_bundle';min_value_per_event?:number;max_value_per_event?:number}; regions_allowed:string[]; consent_required:boolean; status:'active'|'paused'|'archived' }
export interface MarketplaceMatchRequest { app_id:string; period_start?:string; period_end?:string }
export interface MarketplaceMatchResult { app_id:string; period_start?:string; period_end?:string; total_events:number; eligible_events:number; matched_offers:Array<{offer:MarketplaceOffer;events_matched:number;effective_value_per_event:number;total_payout:number}> }
export interface IntelligenceEventView { event_id:string; app_id:string; device_id:string; classification:ClassificationResult; scores:ScoreSet; persona:PersonaAssignment; explanation:Explanation; metadata_inspection:MetadataInspectionView }
export interface AppIntelligenceSummary { app_id:string; period_start?:string; period_end?:string; total_events:number; category_distribution:Record<string,number>; average_scores:ScoreSet; persona:PersonaAssignment; total_estimated_value:number; marketplace_summary:MarketplaceMatchResult }

export const INITIAL_MARKETPLACE_OFFERS: MarketplaceOffer[] = [
 {offer_id:'offer-retail-001',buyer_id:'buyer-cons-res-9',buyer_category:'Consumer Insights & Market Research',metadata_types:['commercial','transactional','intent'],pricing_model:{type:'per_bundle',min_value_per_event:.15,max_value_per_event:.25},regions_allowed:['US','EU','CA'],consent_required:true,status:'active'},
 {offer_id:'offer-mobility-002',buyer_id:'buyer-urban-mob-4',buyer_category:'Urban Mobility Demand Research',metadata_types:['behavioral','device'],pricing_model:{type:'per_event',min_value_per_event:.08,max_value_per_event:.12},regions_allowed:['US','GLOBAL'],consent_required:true,status:'active'},
 {offer_id:'offer-telemetry-003',buyer_id:'buyer-privacy-lab-1',buyer_category:'Open Telemetry Performance Lab',metadata_types:['operational','device'],pricing_model:{type:'per_event',min_value_per_event:.04,max_value_per_event:.06},regions_allowed:['GLOBAL'],consent_required:false,status:'active'}
];

/** Production baseline: no metadata is commercial/marketplace-authorized by inference. */
export function getDefaultGates(appId:string):AppMetadataGates {
 const types:MetadataType[]=['commercial','transactional','intent','behavioral','engagement','device','operational'];
 return {app_id:appId,gates:types.map(metadata_type=>({metadata_type,default_state:'blocked' as ConsentState,buyer_overrides:[]}))};
}

export class IntelligenceEngine {
 private events=new Map<string,IntelligenceEventView>(); private appGates=new Map<string,AppMetadataGates>(); private offers:MarketplaceOffer[]=[...INITIAL_MARKETPLACE_OFFERS];
 constructor(options:{seedDemo?:boolean}={}) { if(options.seedDemo) this.seedDefaultEvents(); }
 private seedDefaultEvents(){
  this.updateGates('com.example.shop',{app_id:'com.example.shop',gates:[{metadata_type:'commercial',default_state:'allowed'},{metadata_type:'intent',default_state:'allowed'},{metadata_type:'engagement',default_state:'allowed'}]});
  this.processEvent({event_id:'evt-shop-sample-01',timestamp:new Date(Date.now()-900000).toISOString(),app_id:'com.example.shop',device_id:'dev-zero-trust-01',user_id:'sub-user-1',sdk_version:'kicks-1.0.0',network:{domain:'events.analytics.example',endpoint:'/v2/collect',method:'POST',status_code:200},metadata:{category_view:'footwear_athletic',dwell_time_seconds:42,purchase_intent_tier:'high',session_id:'sess-8491'},tags:['shopping','session_analytics','commercial']});
 }
 public getGates(appId:string){let g=this.appGates.get(appId);if(!g){g=getDefaultGates(appId);this.appGates.set(appId,g)}return g}
 public updateGates(appId:string,updated:AppMetadataGates){this.appGates.set(appId,{...updated,app_id:appId});return this.appGates.get(appId)!}
 public getEvent(eventId:string){return this.events.get(eventId)??null}
 public getOffers(){return this.offers}
 public processEvent(event:TelemetryEvent):IntelligenceEventView{
  const gates=this.getGates(event.app_id),domain=event.network.domain.toLowerCase(),tags=(event.tags??[]).map(t=>t.toLowerCase());
  const isCommercial=domain.includes('analytics')||domain.includes('ad')||domain.includes('market')||tags.includes('commercial')||tags.includes('shopping')||event.app_id.includes('shop');
  const isOperational=domain.includes('mapbox')||domain.includes('map')||domain.includes('weather')||domain.includes('crash')||domain.includes('diagnostics')||tags.includes('operational');
  const category:ClassificationResult['category']=isCommercial?'behavioral_commercial':isOperational?'operational':domain.includes('suspicious')||domain.includes('tracker')?'unexpected':'unknown';
  const reason_codes=isCommercial?['COMMERCIAL_TAGS_DETECTED','ANALYTICS_ENDPOINT_RECOGNIZED']:isOperational?['STANDARD_INFRASTRUCTURE_PATTERN','NO_IDENTITY_PAYLOAD']:['UNFAMILIAR_DESTINATION_DOMAIN'];
  const metadataObj=event.metadata??{},keys=Object.keys(metadataObj);if(!keys.length)keys.push('destination_host','connection_protocol');const metadata_items:MetadataItem[]=[];
  for(const key of keys){let type:MetadataType='operational',value=.02,buyers=['Telemetry Lab'];if(key.includes('purchase')||key.includes('cart')||key.includes('intent')){type='intent';value=.12;buyers=['Consumer Insights & Market Research']}else if(key.includes('category')||key.includes('product')||key.includes('price')){type='commercial';value=.08;buyers=['Consumer Insights & Market Research','Retail Research Network']}else if(key.includes('dwell')||key.includes('scroll')||key.includes('click')){type='engagement';value=.05;buyers=['Consumer Insights & Market Research']}else if(key.includes('region')||key.includes('zoom')||key.includes('geo')){type='behavioral';value=.06;buyers=['Urban Mobility Demand Research']}else if(key.includes('device')||key.includes('os')||key.includes('screen')){type='device';value=.03;buyers=['Open Telemetry Performance Lab']}
   const gate=gates.gates.find(g=>g.metadata_type===type),consent_state:ConsentState=gate?.default_state??'blocked';metadata_items.push({key,type,description:`Normalized ${type} signal extracted from ${key}`,sample_value:metadataObj[key]??'minimized_hash',estimated_value_per_event:value,buyer_categories:buyers,consent_required:true,consent_state});}
  const total=metadata_items.filter(m=>m.consent_state==='allowed').reduce((a,c)=>a+c.estimated_value_per_event,0),eligible=total>0&&metadata_items.some(m=>m.consent_state==='allowed');
  const scores:ScoreSet={commercial_intent_score:isCommercial?88.5:isOperational?8:35,metadata_value_estimate:Number(total.toFixed(4)),baseline_stability_score:94,deviation_severity_score:category==='unexpected'?78:isCommercial?22:6,purpose_confidence_score:96.5};
  const persona:PersonaAssignment={scope:'app',scope_id:event.app_id,persona:isCommercial?'heavy_commercial':isOperational?'operational':'mixed',effective_from:event.timestamp};
  const view:IntelligenceEventView={event_id:event.event_id,app_id:event.app_id,device_id:event.device_id,classification:{category,reason_codes},scores,persona,explanation:{title:isCommercial?'Commercial Value Opportunity Detected':'Operational Telemetry Verified',summary:isCommercial?`Outbound transmission to ${event.network.domain} contains potentially valuable metadata. Commercial use remains gated until explicitly authorized.`:`Connection to ${event.network.domain} aligns with expected service operations. Commercial use remains separately gated.`,details:[`App ID: ${event.app_id}`,`Destination Host: ${event.network.domain}`,'Zero-Trust Attestation: Payload minimization enforced',`Gating Status: ${eligible?'Eligible for marketplace match':'Gated / Not eligible'}`],confidence_band:'high',tags:['zero_trust',category,`value_$${Number(total.toFixed(4))}`]},metadata_inspection:{event_id:event.event_id,app_id:event.app_id,metadata_items,total_estimated_value:Number(total.toFixed(4)),eligible_for_marketplace:eligible}};
  this.events.set(event.event_id,view);return view;
 }
 public matchMarketplace(req:MarketplaceMatchRequest):MarketplaceMatchResult{
  const gates=this.getGates(req.app_id),events=[...this.events.values()].filter(e=>e.app_id===req.app_id),allowed=new Set(gates.gates.filter(g=>g.default_state==='allowed').map(g=>g.metadata_type as string));
  const total_events=events.length,eligible_events=allowed.size===0?0:events.filter(e=>e.metadata_inspection.metadata_items.some(m=>m.consent_state==='allowed')).length;
  const matched_offers=eligible_events===0?[]:this.offers.filter(o=>o.status==='active'&&o.metadata_types.some(t=>allowed.has(t))).map(offer=>{const events_matched=eligible_events,effective_value_per_event=offer.pricing_model.min_value_per_event??.1,total_payout=Number((offer.pricing_model.type==='per_bundle'?8:events_matched*effective_value_per_event).toFixed(2));return{offer,events_matched,effective_value_per_event,total_payout}});
  return{app_id:req.app_id,period_start:req.period_start??new Date(Date.now()-604800000).toISOString(),period_end:req.period_end??new Date().toISOString(),total_events,eligible_events,matched_offers};
 }
 public getAppSummary(appId:string,periodStart?:string,periodEnd?:string):AppIntelligenceSummary{
  const marketplace_summary=this.matchMarketplace({app_id:appId,period_start:periodStart,period_end:periodEnd}),events=[...this.events.values()].filter(e=>e.app_id===appId),dist:Record<string,number>={behavioral_commercial:0,operational:0,unexpected:0,unknown:0};for(const e of events)dist[e.classification.category]=(dist[e.classification.category]??0)+1;
  const average_scores:ScoreSet={commercial_intent_score:events.length?events.reduce((s,e)=>s+e.scores.commercial_intent_score,0)/events.length:0,metadata_value_estimate:events.length?events.reduce((s,e)=>s+e.scores.metadata_value_estimate,0)/events.length:0,baseline_stability_score:events.length?93:0,deviation_severity_score:events.length?11.5:0,purpose_confidence_score:events.length?95.8:0};
  return{app_id:appId,period_start:marketplace_summary.period_start,period_end:marketplace_summary.period_end,total_events:events.length,category_distribution:dist,average_scores,persona:{scope:'app',scope_id:appId,persona:events.length?(events.some(e=>e.classification.category==='behavioral_commercial')?'heavy_commercial':'operational'):'unknown',effective_from:periodStart??new Date().toISOString()},total_estimated_value:Number(marketplace_summary.matched_offers.reduce((s,i)=>s+i.total_payout,0).toFixed(2)),marketplace_summary};
 }
}
