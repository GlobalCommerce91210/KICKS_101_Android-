import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { MemoryStore } from './store.js';
import type { MemoryConsumerDeviceBindingStore } from './consumer-device-bindings.js';

export type IosProvisionInput = { requestId: string; accountSubjectId: string; deviceId: string; deviceToken: string; publicKey: string };
export type IosProvisionResult = { deviceId: string; accountSubjectId: string; status: 'provisioned' | 'replayed' };
export interface IosDeviceProvisioner { provision(input: IosProvisionInput): Promise<IosProvisionResult> }
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const result = (input: IosProvisionInput, replayed: boolean): IosProvisionResult => ({deviceId:input.deviceId,accountSubjectId:input.accountSubjectId,status:replayed?'replayed':'provisioned'});
type Proof = Omit<IosProvisionInput,'deviceToken'> & { tokenHash: string };
const proof = ({deviceToken,...input}:IosProvisionInput):Proof => ({...input,tokenHash:tokenHash(deviceToken)});
const same = (a: Proof,b:Proof) => a.requestId===b.requestId && a.accountSubjectId===b.accountSubjectId && a.deviceId===b.deviceId && a.tokenHash===b.tokenHash && a.publicKey===b.publicKey;

// Test-only: explicit dependencies prevent mixing this with persistent stores.
export class MemoryIosDeviceProvisioner implements IosDeviceProvisioner {
  private requests=new Map<string,Proof>();
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private readonly store:MemoryStore,private readonly bindings:MemoryConsumerDeviceBindingStore){}
  provision(input:IosProvisionInput) {
    const operation=this.queue.then(async()=>{
      const value=proof(input); const prior=this.requests.get(input.requestId);
      if(prior){
        const binding=(await this.bindings.list(input.accountSubjectId)).find(b=>b.device_id===input.deviceId&&b.platform==='ios');
        if(!same(prior,value)||!binding||!await this.store.findDeviceByTokenHash(value.tokenHash)) throw Error('provisioning_conflict');
        return result(input,true);
      }
      if(this.store.devices.has(input.deviceId)||[...this.store.devices.values()].some(d=>d.tokenHash===value.tokenHash)||
        [...this.requests.values()].some(p=>p.publicKey===input.publicKey)) throw Error('provisioning_conflict');
      if((await this.bindings.list(input.accountSubjectId)).filter(b=>b.platform==='ios').length>=5)throw Error('ios_device_limit');
      const collectorSubjectId=randomUUID();
      await this.bindings.bind({subjectId:input.accountSubjectId,deviceId:input.deviceId,collectorSubjectId,platform:'ios',displayName:'iPad collector'});
      this.store.devices.set(input.deviceId,{id:input.deviceId,subjectId:collectorSubjectId,tokenHash:value.tokenHash,revoked:false});
      this.requests.set(input.requestId,value);
      return result(input,false);
    });
    this.queue=operation.catch(()=>{}); return operation;
  }
}

export class PostgresIosDeviceProvisioner implements IosDeviceProvisioner {
  constructor(private readonly pool:Pool){}
  async provision(input:IosProvisionInput):Promise<IosProvisionResult>{
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ios_device_provisioning (
      request_id UUID PRIMARY KEY,account_subject_id TEXT NOT NULL REFERENCES consumer_accounts(subject_id),
      device_id UUID NOT NULL UNIQUE REFERENCES devices(id),public_key TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ios_device_provisioning'))");
      const value=proof(input);
      const prior=await client.query('SELECT * FROM ios_device_provisioning WHERE request_id=$1',[input.requestId]);
      if(prior.rows[0]){
        const row=prior.rows[0];
        if(!same({requestId:String(row.request_id),accountSubjectId:String(row.account_subject_id),deviceId:String(row.device_id),publicKey:String(row.public_key),tokenHash:String(row.token_hash)},value)) throw Error('provisioning_conflict');
        const active=await client.query(`SELECT d.id FROM devices d JOIN consumer_device_bindings b ON b.device_id=d.id::text
          WHERE d.id=$1 AND d.token_hash=$2 AND d.revoked_at IS NULL AND b.subject_id=$3 AND b.status='active' AND b.platform='ios'
          AND b.collector_subject_id=d.subject_id::text`,[input.deviceId,value.tokenHash,input.accountSubjectId]);
        if(!active.rowCount)throw Error('provisioning_conflict');
        await client.query('COMMIT');return result(input,true);
      }
      const collectorSubjectId=randomUUID();
      const count=await client.query("SELECT count(*)::int AS n FROM consumer_device_bindings WHERE subject_id=$1 AND status='active' AND platform='ios'",[input.accountSubjectId]);
      if(Number(count.rows[0]?.n)>=5)throw Error('ios_device_limit');
      // Plain INSERT only: collisions must never overwrite or revive a device/binding.
      await client.query("INSERT INTO devices(id,subject_id,token_hash,environment) VALUES($1,$2,$3,'staging')",[input.deviceId,collectorSubjectId,value.tokenHash]);
      await client.query(`INSERT INTO consumer_device_bindings(binding_id,subject_id,device_id,collector_subject_id,status,display_name,platform,bound_at)
        VALUES($1,$2,$3,$4,'active','iPad collector','ios',now())`,['bind_'+randomUUID(),input.accountSubjectId,input.deviceId,collectorSubjectId]);
      await client.query('INSERT INTO ios_device_provisioning(request_id,account_subject_id,device_id,public_key,token_hash) VALUES($1,$2,$3,$4,$5)',
        [input.requestId,input.accountSubjectId,input.deviceId,input.publicKey,value.tokenHash]);
      await client.query('COMMIT');return result(input,false);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
