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
export interface ClassificationResult { category:'operational'|'behavioral_commercial'|'unexpected'|'unknown'; reason_codes:string[] }
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

export const INITIAL_MARKETPLACE_OFFERS: MarketplaceOffer[] = [];

export function getDefaultGates(appId:string):AppMetadataGates {
  return { app_id:appId, gates:[
    {metadata_type:'commercial',default_state:'conditional',buyer_overrides:[]},
    {metadata_type:'transactional',default_state:'conditional',buyer_overrides:[]},
    {metadata_type:'intent',default_state:'conditional',buyer_overrides:[]},
    {metadata_type:'behavioral',default_state:'conditional',buyer_overrides:[]},
    {metadata_type:'engagement',default_state:'conditional',buyer_overrides:[]},
    {metadata_type:'device',default_state:'conditional',buyer_overrides:[]},
    {metadata_type:'operational',default_state:'allowed',buyer_overrides:[]},
  ]};
}

export class IntelligenceEngine {
  private events = new Map<string,IntelligenceEventView>();
  private appGates = new Map<string,AppMetadataGates>();
  private offers:MarketplaceOffer[] = [];

  public getGates(appId:string):AppMetadataGates {
    const existing=this.appGates.get(appId); if(existing)return existing;
    const created=getDefaultGates(appId);this.appGates.set(appId,created);return created;
  }
  public updateGates(appId:string,updated:AppMetadataGates):AppMetadataGates {const next={...updated,app_id:appId};this.appGates.set(appId,next);return next}
  public getEvent(eventId:string):IntelligenceEventView|null{return this.events.get(eventId)??null}
  public getOffers():MarketplaceOffer[]{return [...this.offers]}
  public setOffers(offers:MarketplaceOffer[]):void {this.offers=offers.filter(offer=>offer.status!=='archived')}

  public processEvent(event:TelemetryEvent):IntelligenceEventView {
    const gates=this.getGates(event.app_id);
    const domain=event.network.domain.toLowerCase();
    const tags=(event.tags??[]).map(v=>v.toLowerCase());
    const commercialEvidence=['analytics','advert','market','commerce','retail','shop'].some(token=>domain.includes(token))||tags.some(tag=>['commercial','shopping','advertising','analytics'].includes(tag));
    const operationalEvidence=['map','weather','cdn','crash','diagnostic','update'].some(token=>domain.includes(token))||tags.includes('operational');
    const unexpectedEvidence=['tracker','suspicious','unknown-broker'].some(token=>domain.includes(token))||tags.includes('unexpected');
    const category:ClassificationResult['category']=unexpectedEvidence?'unexpected':commercialEvidence?'behavioral_commercial':operationalEvidence?'operational':'unknown';
    const reason_codes:string[]=[];
    if(unexpectedEvidence)reason_codes.push('UNEXPECTED_DESTINATION_EVIDENCE');
    if(commercialEvidence)reason_codes.push('COMMERCIAL_DESTINATION_OR_TAG_EVIDENCE');
    if(operationalEvidence)reason_codes.push('OPERATIONAL_DESTINATION_OR_TAG_EVIDENCE');
    if(reason_codes.length===0)reason_codes.push('INSUFFICIENT_EVIDENCE_FOR_CLASSIFICATION');

    const metadataObj=event.metadata??{};
    const keys=Object.keys(metadataObj).length?Object.keys(metadataObj):['destination_host','connection_protocol'];
    const metadata_items:MetadataItem[]=keys.map(key=>{
      const type=metadataTypeForKey(key);
      const gate=gates.gates.find(item=>item.metadata_type===type);
      return {key,type,description:`Minimized ${type} signal`,sample_value:null,estimated_value_per_event:0,buyer_categories:[],consent_required:type!=='operational',consent_state:gate?.default_state??'conditional'};
    });
    const eligible_for_marketplace=metadata_items.some(item=>item.consent_state==='allowed'&&item.type!=='operational')&&this.offers.length>0;
    const scores:ScoreSet={
      commercial_intent_score:commercialEvidence?75:category==='unknown'?25:0,
      metadata_value_estimate:0,
      baseline_stability_score:0,
      deviation_severity_score:unexpectedEvidence?80:0,
      purpose_confidence_score:category==='unknown'?30:70,
    };
    const persona:PersonaAssignment={scope:'app',scope_id:event.app_id,persona:category==='behavioral_commercial'?'heavy_commercial':category==='operational'?'operational':category==='unknown'?'unknown':'mixed',effective_from:event.timestamp};
    const inspection:MetadataInspectionView={event_id:event.event_id,app_id:event.app_id,metadata_items,total_estimated_value:0,eligible_for_marketplace};
    const explanation:Explanation={
      title:category==='unknown'?'Purpose still under review':category==='unexpected'?'Unexpected destination evidence':'Observed network purpose classification',
      summary:`${event.app_id} contacted ${event.network.domain}. KICK'S classified the destination from observed network evidence only.`,
      details:[`Destination: ${event.network.domain}`,`Method: ${event.network.method}`,`Marketplace eligibility: ${eligible_for_marketplace?'verified candidate':'not verified'}`],
      confidence_band:category==='unknown'?'low':'medium',
      tags:['metadata_only',category],
    };
    const view:IntelligenceEventView={event_id:event.event_id,app_id:event.app_id,device_id:event.device_id,classification:{category,reason_codes},scores,persona,explanation,metadata_inspection:inspection};
    this.events.set(event.event_id,view);return view;
  }

  public matchMarketplace(req:MarketplaceMatchRequest):MarketplaceMatchResult {
    const appEvents=[...this.events.values()].filter(event=>event.app_id===req.app_id);
    const eligible=appEvents.filter(event=>event.metadata_inspection.eligible_for_marketplace);
    const matched_offers=this.offers.filter(offer=>offer.status==='active').flatMap(offer=>{
      const matching=eligible.filter(event=>event.metadata_inspection.metadata_items.some(item=>item.consent_state==='allowed'&&offer.metadata_types.includes(item.type)));
      if(matching.length===0)return [];
      const rate=offer.pricing_model.min_value_per_event;
      if(rate==null)return [];
      const payout=offer.pricing_model.type==='per_event'?matching.length*rate:rate;
      return [{offer,events_matched:matching.length,effective_value_per_event:rate,total_payout:Number(payout.toFixed(2))}];
    });
    return {app_id:req.app_id,period_start:req.period_start,period_end:req.period_end,total_events:appEvents.length,eligible_events:eligible.length,matched_offers};
  }

  public getAppSummary(appId:string,periodStart?:string,periodEnd?:string):AppIntelligenceSummary {
    const appEvents=[...this.events.values()].filter(event=>event.app_id===appId);
    const category_distribution:Record<string,number>={behavioral_commercial:0,operational:0,unexpected:0,unknown:0};
    for(const event of appEvents)category_distribution[event.classification.category]=(category_distribution[event.classification.category]??0)+1;
    const average_scores=averageScores(appEvents.map(event=>event.scores));
    const dominant=dominantPersona(appEvents);
    const marketplace_summary=this.matchMarketplace({app_id:appId,period_start:periodStart,period_end:periodEnd});
    const total_estimated_value=Number(marketplace_summary.matched_offers.reduce((sum,item)=>sum+item.total_payout,0).toFixed(2));
    return {app_id:appId,period_start:periodStart,period_end:periodEnd,total_events:appEvents.length,category_distribution,average_scores,persona:{scope:'app',scope_id:appId,persona:dominant,effective_from:appEvents[0]?.persona.effective_from??new Date().toISOString()},total_estimated_value,marketplace_summary};
  }
}

function metadataTypeForKey(key:string):MetadataType {
  const value=key.toLowerCase();
  if(value.includes('purchase')||value.includes('cart')||value.includes('intent'))return 'intent';
  if(value.includes('category')||value.includes('product')||value.includes('price'))return 'commercial';
  if(value.includes('transaction')||value.includes('basket'))return 'transactional';
  if(value.includes('dwell')||value.includes('scroll')||value.includes('click')||value.includes('session'))return 'engagement';
  if(value.includes('region')||value.includes('zoom')||value.includes('geo')||value.includes('location'))return 'behavioral';
  if(value.includes('device')||value.includes('os')||value.includes('screen'))return 'device';
  return 'operational';
}
function averageScores(values:ScoreSet[]):ScoreSet {
  if(values.length===0)return{commercial_intent_score:0,metadata_value_estimate:0,baseline_stability_score:0,deviation_severity_score:0,purpose_confidence_score:0};
  const total=values.reduce((sum,current)=>({commercial_intent_score:sum.commercial_intent_score+current.commercial_intent_score,metadata_value_estimate:sum.metadata_value_estimate+current.metadata_value_estimate,baseline_stability_score:sum.baseline_stability_score+current.baseline_stability_score,deviation_severity_score:sum.deviation_severity_score+current.deviation_severity_score,purpose_confidence_score:sum.purpose_confidence_score+current.purpose_confidence_score}),{commercial_intent_score:0,metadata_value_estimate:0,baseline_stability_score:0,deviation_severity_score:0,purpose_confidence_score:0});
  return Object.fromEntries(Object.entries(total).map(([key,value])=>[key,Number((value/values.length).toFixed(2))])) as unknown as ScoreSet;
}
function dominantPersona(events:IntelligenceEventView[]):PersonaAssignment['persona'] {
  if(events.length===0)return 'unknown';
  const counts=new Map<PersonaAssignment['persona'],number>();for(const event of events)counts.set(event.persona.persona,(counts.get(event.persona.persona)??0)+1);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??'unknown';
}
