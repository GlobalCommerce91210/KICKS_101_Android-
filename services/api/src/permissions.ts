import { randomUUID } from 'node:crypto';
import { IntelligenceEngine, MetadataType } from './intelligence.js';

export type PermissionState = 'allowed' | 'blocked' | 'limited';
export type MetadataState = 'allowed' | 'blocked' | 'conditional';
export interface AppPermission { app_id:string; app_name:string; state:PermissionState; reason?:string; last_updated:string }
export interface MetadataPermission { metadata_type:MetadataType; key?:string; state:MetadataState; buyer_overrides?:Array<{buyer_category:string;state:MetadataState}>; last_updated:string }
export interface BuyerPermission { buyer_category:string; state:PermissionState; max_value_band?:number; last_updated:string }
export interface EffectivePermissionsView { user_id:string; apps:AppPermission[]; metadata_permissions:MetadataPermission[]; buyers:BuyerPermission[] }
export interface ConsentLogEntry { log_id:string; user_id:string; app_id?:string|null; metadata_type?:string|null; key?:string|null; buyer_category?:string|null; previous_state?:string|null; new_state:string; context:string; timestamp:string }

export class PermissionsEngine {
  private userApps=new Map<string,AppPermission[]>();
  private userMetadata=new Map<string,Map<string,MetadataPermission[]>>();
  private userBuyers=new Map<string,BuyerPermission[]>();
  private consentLogs=new Map<string,ConsentLogEntry[]>();
  constructor(private intelligenceEngine?:IntelligenceEngine){}

  public getAppPermissions(userId:string):AppPermission[]{return this.userApps.get(userId)??[]}
  public setAppPermissions(userId:string,apps:AppPermission[],context='permissions_dashboard'):AppPermission[]{
    const existingMap=new Map(this.getAppPermissions(userId).map(app=>[app.app_id,app]));const now=new Date().toISOString();
    for(const incoming of apps){const prev=existingMap.get(incoming.app_id);const next={...incoming,last_updated:now};if(!prev||prev.state!==next.state)this.appendLog({log_id:`clog-${randomUUID().slice(0,8)}`,user_id:userId,app_id:next.app_id,previous_state:prev?.state??'blocked',new_state:next.state,context,timestamp:now});existingMap.set(next.app_id,next)}
    const updated=[...existingMap.values()];this.userApps.set(userId,updated);return updated;
  }

  public getMetadataPermissions(userId:string,appId:string):MetadataPermission[]{
    let appMap=this.userMetadata.get(userId);if(!appMap){appMap=new Map();this.userMetadata.set(userId,appMap)}
    let permissions=appMap.get(appId);if(!permissions){const now=new Date().toISOString();permissions=[
      {metadata_type:'commercial',state:'blocked',buyer_overrides:[],last_updated:now},
      {metadata_type:'transactional',state:'blocked',buyer_overrides:[],last_updated:now},
      {metadata_type:'intent',state:'blocked',buyer_overrides:[],last_updated:now},
      {metadata_type:'behavioral',state:'blocked',buyer_overrides:[],last_updated:now},
      {metadata_type:'engagement',state:'blocked',buyer_overrides:[],last_updated:now},
      {metadata_type:'device',state:'blocked',buyer_overrides:[],last_updated:now},
      {metadata_type:'operational',state:'blocked',buyer_overrides:[],last_updated:now},
    ];appMap.set(appId,permissions)}
    return permissions;
  }

  public setMetadataPermissions(userId:string,appId:string,permissions:MetadataPermission[],context='metadata_inspector'):MetadataPermission[]{
    const existingMap=new Map(this.getMetadataPermissions(userId,appId).map(item=>[item.metadata_type,item]));const now=new Date().toISOString();
    for(const incoming of permissions){const prev=existingMap.get(incoming.metadata_type);const next={...incoming,last_updated:now};if(!prev||prev.state!==next.state)this.appendLog({log_id:`clog-${randomUUID().slice(0,8)}`,user_id:userId,app_id:appId,metadata_type:next.metadata_type,previous_state:prev?.state??'blocked',new_state:next.state,context,timestamp:now});existingMap.set(next.metadata_type,next)}
    const updated=[...existingMap.values()];this.userMetadata.get(userId)?.set(appId,updated);
    this.intelligenceEngine?.updateGates(appId,{app_id:appId,gates:updated.map(item=>({metadata_type:item.metadata_type,default_state:item.state,buyer_overrides:item.buyer_overrides}))});
    return updated;
  }

  public getBuyerPermissions(userId:string):BuyerPermission[]{return this.userBuyers.get(userId)??[]}
  public setBuyerPermissions(userId:string,buyers:BuyerPermission[],context='buyer_controls'):BuyerPermission[]{
    const existingMap=new Map(this.getBuyerPermissions(userId).map(item=>[item.buyer_category,item]));const now=new Date().toISOString();
    for(const incoming of buyers){const prev=existingMap.get(incoming.buyer_category);const next={...incoming,last_updated:now};if(!prev||prev.state!==next.state)this.appendLog({log_id:`clog-${randomUUID().slice(0,8)}`,user_id:userId,buyer_category:next.buyer_category,previous_state:prev?.state??'blocked',new_state:next.state,context,timestamp:now});existingMap.set(next.buyer_category,next)}
    const updated=[...existingMap.values()];this.userBuyers.set(userId,updated);return updated;
  }

  public getEffectivePermissions(userId:string):EffectivePermissionsView{
    const allMeta:MetadataPermission[]=[];const appMap=this.userMetadata.get(userId);if(appMap)for(const list of appMap.values())for(const item of list)if(!allMeta.some(existing=>existing.metadata_type===item.metadata_type&&existing.state===item.state))allMeta.push(item);
    return {user_id:userId,apps:this.getAppPermissions(userId),metadata_permissions:allMeta,buyers:this.getBuyerPermissions(userId)};
  }
  public getConsentLog(userId:string,page=1,pageSize=50){const logs=this.consentLogs.get(userId)??[];const start=(page-1)*pageSize;return{items:logs.slice(start,start+pageSize),page,page_size:pageSize}}
  private appendLog(entry:ConsentLogEntry){const list=this.consentLogs.get(entry.user_id)??[];list.unshift(entry);this.consentLogs.set(entry.user_id,list)}
}
