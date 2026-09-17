import { randomUUID } from 'node:crypto';
import { IntelligenceEngine, MetadataType } from './intelligence.js';

export type PermissionState = 'allowed' | 'blocked' | 'limited';
export type MetadataState = 'allowed' | 'blocked' | 'conditional';

export interface AppPermission { app_id:string; app_name:string; state:PermissionState; reason?:string; last_updated:string }
export interface MetadataPermission { metadata_type:MetadataType; key?:string; state:MetadataState; buyer_overrides?:Array<{buyer_category:string;state:MetadataState}>; last_updated:string }
export interface BuyerPermission { buyer_category:string; state:PermissionState; max_value_band?:number; last_updated:string }
export interface EffectivePermissionsView { user_id:string; apps:AppPermission[]; metadata_permissions:MetadataPermission[]; buyers:BuyerPermission[] }
export interface ConsentLogEntry { log_id:string; user_id:string; app_id?:string|null; metadata_type?:string|null; key?:string|null; buyer_category?:string|null; previous_state?:string|null; new_state:string; context:string; timestamp:string }

const METADATA_TYPES: MetadataType[] = ['commercial','transactional','intent','behavioral','engagement','device','operational'];

/**
 * Commercial/marketplace authorization is deliberately fail-closed.
 * Demo fixtures are available only when explicitly requested by the caller.
 * Collector monitoring consent is owned by the collector consent-event path and
 * is never inferred from these permissions.
 */
export class PermissionsEngine {
  private userApps=new Map<string,AppPermission[]>();
  private userMetadata=new Map<string,Map<string,MetadataPermission[]>>();
  private userBuyers=new Map<string,BuyerPermission[]>();
  private consentLogs=new Map<string,ConsentLogEntry[]>();

  constructor(private intelligenceEngine?:IntelligenceEngine, options:{seedDemo?:boolean}={}) {
    if(options.seedDemo===true) this.seedDemoUser('user_demo_01');
  }

  private seedDemoUser(userId:string){
    const updated=new Date().toISOString();
    this.userApps.set(userId,[
      {app_id:'com.example.shop',app_name:'Shop Sample',state:'allowed',reason:'Explicit demo fixture',last_updated:updated},
      {app_id:'com.example.transit',app_name:'Transit Map',state:'limited',reason:'Explicit demo fixture',last_updated:updated}
    ]);
    const meta=new Map<string,MetadataPermission[]>();
    meta.set('com.example.shop',METADATA_TYPES.map(metadata_type=>({metadata_type,state:metadata_type==='operational'?'allowed':'conditional',buyer_overrides:[],last_updated:updated})));
    this.userMetadata.set(userId,meta);
    this.userBuyers.set(userId,[{buyer_category:'Consumer Insights & Market Research',state:'allowed',max_value_band:10,last_updated:updated}]);
    this.consentLogs.set(userId,[]);
  }

  private appendLog(entry:ConsentLogEntry){const list=this.consentLogs.get(entry.user_id)??[];list.unshift(entry);this.consentLogs.set(entry.user_id,list)}

  public getAppPermissions(userId:string):AppPermission[]{ return this.userApps.get(userId)??[] }

  public setAppPermissions(userId:string,apps:AppPermission[],context='permissions_dashboard'):AppPermission[]{
    const existingMap=new Map(this.getAppPermissions(userId).map(a=>[a.app_id,a]));
    const now=new Date().toISOString();
    for(const app of apps){
      const prev=existingMap.get(app.app_id);
      if(!prev||prev.state!==app.state)this.appendLog({log_id:`clog-${randomUUID().slice(0,8)}`,user_id:userId,app_id:app.app_id,previous_state:prev?.state??'blocked',new_state:app.state,context,timestamp:now});
      existingMap.set(app.app_id,{...app,last_updated:now});
    }
    const updated=[...existingMap.values()];this.userApps.set(userId,updated);return updated;
  }

  public getMetadataPermissions(userId:string,appId:string):MetadataPermission[]{
    let appMap=this.userMetadata.get(userId);
    if(!appMap){appMap=new Map();this.userMetadata.set(userId,appMap)}
    let perms=appMap.get(appId);
    if(!perms){
      const now=new Date().toISOString();
      perms=METADATA_TYPES.map(metadata_type=>({metadata_type,state:'blocked',buyer_overrides:[],last_updated:now}));
      appMap.set(appId,perms);
    }
    return perms;
  }

  public setMetadataPermissions(userId:string,appId:string,permissions:MetadataPermission[],context='metadata_inspector'):MetadataPermission[]{
    const existingMap=new Map(this.getMetadataPermissions(userId,appId).map(m=>[m.metadata_type,m]));
    const now=new Date().toISOString();
    for(const p of permissions){
      const prev=existingMap.get(p.metadata_type);
      if(!prev||prev.state!==p.state)this.appendLog({log_id:`clog-${randomUUID().slice(0,8)}`,user_id:userId,app_id:appId,metadata_type:p.metadata_type,previous_state:prev?.state??'blocked',new_state:p.state,context,timestamp:now});
      existingMap.set(p.metadata_type,{...p,last_updated:now});
    }
    const updated=[...existingMap.values()];this.userMetadata.get(userId)?.set(appId,updated);
    if(this.intelligenceEngine)this.intelligenceEngine.updateGates(appId,{app_id:appId,gates:updated.map(u=>({metadata_type:u.metadata_type,default_state:u.state,buyer_overrides:u.buyer_overrides}))});
    return updated;
  }

  public getBuyerPermissions(userId:string):BuyerPermission[]{ return this.userBuyers.get(userId)??[] }

  public setBuyerPermissions(userId:string,buyers:BuyerPermission[],context='buyer_controls'):BuyerPermission[]{
    const existingMap=new Map(this.getBuyerPermissions(userId).map(b=>[b.buyer_category,b]));
    const now=new Date().toISOString();
    for(const b of buyers){
      const prev=existingMap.get(b.buyer_category);
      if(!prev||prev.state!==b.state)this.appendLog({log_id:`clog-${randomUUID().slice(0,8)}`,user_id:userId,buyer_category:b.buyer_category,previous_state:prev?.state??'blocked',new_state:b.state,context,timestamp:now});
      existingMap.set(b.buyer_category,{...b,last_updated:now});
    }
    const updated=[...existingMap.values()];this.userBuyers.set(userId,updated);return updated;
  }

  public getEffectivePermissions(userId:string):EffectivePermissionsView{
    const allMeta:MetadataPermission[]=[];const appMap=this.userMetadata.get(userId);
    if(appMap)for(const list of appMap.values())for(const item of list)if(!allMeta.some(m=>m.metadata_type===item.metadata_type&&m.state===item.state))allMeta.push(item);
    return{user_id:userId,apps:this.getAppPermissions(userId),metadata_permissions:allMeta,buyers:this.getBuyerPermissions(userId)};
  }

  public getConsentLog(userId:string,page=1,pageSize=50){const logs=this.consentLogs.get(userId)??[];const start=(page-1)*pageSize;return{items:logs.slice(start,start+pageSize),page,page_size:pageSize}}
}
