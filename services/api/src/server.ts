import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  AppMetadataGates,
  IntelligenceEngine,
  MarketplaceMatchRequest,
  TelemetryEvent
} from './intelligence.js';
import { WalletEngine } from './wallet.js';
import {
  AppPermission,
  BuyerPermission,
  MetadataPermission,
  PermissionsEngine
} from './permissions.js';

export * from './intelligence.js';
export * from './wallet.js';
export * from './permissions.js';
export * from './branding.js';
import { KICKS_BRAND_MANIFEST } from './branding.js';
import type { ConsentEvent, ConsentRepository } from './consent-repository.js';
import type { DeviceRepository } from './device-repository.js';
import type { MetadataRepository } from './metadata-repository.js';
import { CollectorAuthorizationError, CollectorAuthorizationService } from './collector-authorization.js';
import type { CollectorAuthorizationRequest, CollectorAuthorizationResult } from './collector-authorization.js';

export * from './collector-authorization.js';
export type CollectorAuditEntry={at:string;operation:string;deviceId:string;state:string;reason:string;observations:number};

type Device={id:string;subjectId:string;tokenHash:string;revoked:boolean};type Consent={id:string;decisionId?:string;decisionVersion?:string;subjectId:string;purpose:string;policyVersion:string;purposeVersion:string;state:'granted'|'revoked'};
const observation=z.object({eventId:z.string().uuid(),occurredAt:z.string().datetime(),sourceApp:z.string().min(1).max(180).nullable(),attribution:z.enum(['verified','best_effort','unknown']),destinationHost:z.string().regex(/^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/),protocol:z.enum(['dns','tcp','udp','tls','quic','other']),bytesBucket:z.enum(['0-1KB','1-10KB','10-100KB','100KB-1MB','1MB+']),classification:z.enum(['expected','review','unpermissioned','unknown']),consentId:z.string().uuid(),consentPurpose:z.string().min(3).max(120)}).strict();
type Observation=z.infer<typeof observation>;export interface Store{devices:Map<string,Device>;consents:Map<string,Consent>;consentHistory:ConsentEvent[];consentRequests:Map<string,ConsentEvent>;batches:Set<string>;observations:Observation[];collectorAudit:CollectorAuditEntry[]};export const memoryStore=():Store=>({devices:new Map(),consents:new Map(),consentHistory:[],consentRequests:new Map(),batches:new Set(),observations:[],collectorAudit:[]});
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const decision=z.object({permissionId:z.string().uuid(),requestId:z.string().uuid(),expectedEventSequence:z.number().int().nonnegative().optional(),action:z.enum(['grant','deny','revoke']),policyVersion:z.string().min(1).max(64),purposeVersion:z.string().min(1).max(64),purpose:z.string().min(3).max(120)}).strict();
const batch=z.object({batchId:z.string().uuid(),schemaVersion:z.literal('2026-08-01'),observations:z.array(observation).min(1).max(250)}).strict();

export function buildServer(options:{store?:Store;adminSecret?:string;intelligenceEngine?:IntelligenceEngine;walletEngine?:WalletEngine;permissionsEngine?:PermissionsEngine;consentRepository?:ConsentRepository;deviceRepository?:DeviceRepository;metadataRepository?:MetadataRepository;collectorAuthorization?:CollectorAuthorizationService;onCollectorStop?:(subjectId:string)=>void;allowSyntheticDevelopmentEvents?:boolean}={}){
  const store=options.store??memoryStore();
  const adminSecret=options.adminSecret??process.env.KICKS_STAGING_ADMIN_SECRET??'';
  const engine = options.intelligenceEngine ?? new IntelligenceEngine();
  const permissionsEngine = options.permissionsEngine ?? new PermissionsEngine(engine);
  const walletEngine = options.walletEngine ?? new WalletEngine(engine, permissionsEngine);
  const app=Fastify({logger:{redact:['req.headers.authorization','req.headers.x-admin-secret']},genReqId:()=>randomUUID(),bodyLimit:256000});
  const collectorAuth=options.collectorAuthorization??new CollectorAuthorizationService(undefined);
  const syntheticAllowed=options.allowSyntheticDevelopmentEvents===true&&process.env.NODE_ENV!=='production';
  const auditDenied=(operation:string,deviceId:string,result:CollectorAuthorizationResult,observations:number,log:{warn:(o:object,m:string)=>void})=>{const entry:CollectorAuditEntry={at:new Date().toISOString(),operation,deviceId,state:result.state,reason:result.reason,observations};store.collectorAudit.push(entry);if(store.collectorAudit.length>1000)store.collectorAudit.shift();log.warn(entry,'collector authorization denied')};
  const denyStatus=(result:CollectorAuthorizationResult)=>result.state==='BLOCKED_SERVICE_UNAVAILABLE'?503:403;
  const sendDenied=(r:{header:(k:string,v:string)=>unknown;code:(n:number)=>{send:(b:unknown)=>unknown}},result:CollectorAuthorizationResult)=>{const status=denyStatus(result);if(status===503)r.header('retry-after','1');return r.code(status).send({error:status===503?'collector_authorization_unavailable':'collector_not_authorized',state:result.state,eligible:false})};
  const stopCollectors=(subjectId:string,deviceId?:string)=>{collectorAuth.revokeAllForSubject(subjectId);if(deviceId)collectorAuth.revokeAllForDevice(deviceId);try{options.onCollectorStop?.(subjectId)}catch{}};
  app.register(cors,{origin:true});
  app.addHook('onSend',async(_q,r,p)=>{r.header('cache-control','no-store').header('x-content-type-options','nosniff');return p});
  app.get('/health',async()=>({status:'ok',service:'kicks-api',mode:'staging',collector:'metadata-only'}));

  const deviceContextHeader=(headers:{[key:string]:string|string[]|undefined})=>{const value=headers['x-kicks-device'];return value===undefined?undefined:Array.isArray(value)?(value.length===1?value[0]:''):value};
  const authenticate=async(authorization?:string,suppliedDeviceId?:string)=>{const[scheme,token]=authorization?.split(' ')??[];if(scheme!=='Bearer'||!token)return null;const tokenHash=hash(token);const device=options.deviceRepository?await options.deviceRepository.findActiveByTokenHash(tokenHash):[...store.devices.values()].find(d=>!d.revoked&&equal(d.tokenHash,tokenHash))??null;return device&&(suppliedDeviceId===undefined||suppliedDeviceId===device.id)?device:null};
  app.post('/v1/staging/devices',async(q,r)=>{if(!adminSecret||!equal(hash(String(q.headers['x-admin-secret']??'')),hash(adminSecret)))return r.code(403).send({error:'forbidden'});const parsed=z.object({subjectId:z.string().uuid()}).strict().safeParse(q.body);if(!parsed.success)return r.code(400).send({error:'invalid_request'});const token=randomBytes(32).toString('base64url'),device:Device={id:randomUUID(),subjectId:parsed.data.subjectId,tokenHash:hash(token),revoked:false};if(options.deviceRepository){try{await options.deviceRepository.create(device,process.env.NODE_ENV==='production'?'production':'staging')}catch(error){q.log.error({err:error},'device persistence failed');return r.header('retry-after','1').code(503).send({error:'device_persistence_unavailable',retryable:true})}}else{store.devices.set(device.id,device)}return r.code(201).send({deviceId:device.id,token,tokenType:'Bearer'})});
  app.post('/v1/devices/revoke',async(q,r)=>{let device: Awaited<ReturnType<typeof authenticate>>;try{device=await authenticate(q.headers.authorization, deviceContextHeader(q.headers))}catch(error){q.log.error({err:error},'device revocation authentication unavailable');return r.header('retry-after','1').code(503).send({error:'device_authentication_unavailable',retryable:true})}if(!device)return r.code(401).send({error:'unauthorized'});try{if(options.deviceRepository){const revoked=await options.deviceRepository.revokeByTokenHash(device.tokenHash);if(!revoked)return r.code(409).send({error:'device_already_revoked'});}else{const stored=store.devices.get(device.id);if(!stored||stored.revoked)return r.code(409).send({error:'device_already_revoked'});stored.revoked=true;}stopCollectors(device.subjectId,device.id);return r.code(200).send({deviceId:device.id,revoked:true,monitoringDefaultOn:false})}catch(error){q.log.error({err:error},'device revocation persistence failed');return r.header('retry-after','1').code(503).send({error:'device_revocation_unavailable',retryable:true})}});
  app.post('/v1/consent-events',async(q,r)=>{let device: Awaited<ReturnType<typeof authenticate>>;try{device=await authenticate(q.headers.authorization, deviceContextHeader(q.headers))}catch(error){q.log.error({err:error},'device authentication unavailable');return r.header('retry-after','1').code(503).send({error:'device_authentication_unavailable',retryable:true})}if(!device)return r.code(401).send({error:'unauthorized'});const parsed=decision.safeParse(q.body);if(!parsed.success)return r.code(400).send({error:'invalid_request',issues:parsed.error.issues});const input={...parsed.data,subjectId:device.subjectId};try{const prior=store.consents.get(input.permissionId);if(prior&&prior.subjectId!==device.subjectId)return r.code(409).send({error:'permission_owner_mismatch'});let event:ConsentEvent;if(options.consentRepository){event=await options.consentRepository.recordDecision(input);stopCollectors(device.subjectId)}else{const duplicate=store.consentRequests.get(input.requestId);if(duplicate){if(duplicate.subjectId!==input.subjectId||duplicate.permissionId!==input.permissionId||duplicate.action!==input.action||duplicate.policyVersion!==input.policyVersion||duplicate.purposeVersion!==input.purposeVersion||duplicate.purpose!==input.purpose)return r.code(409).send({error:'idempotency_key_reused_with_different_request'});return r.code(202).send({...duplicate,status:'accepted',idempotentReplay:true})}const currentSequence=store.consentHistory.filter(e=>e.permissionId===input.permissionId).length;if(input.expectedEventSequence!==undefined&&input.expectedEventSequence!==currentSequence)return r.code(409).send({error:'stale_consent_decision'});event={...input,id:randomUUID(),eventSequence:currentSequence+1,occurredAt:new Date().toISOString()};store.consentHistory.push(event);store.consentRequests.set(input.requestId,event)}const consent:Consent={id:input.permissionId,decisionId:event.id,decisionVersion:event.eventSequence===undefined?undefined:String(event.eventSequence),subjectId:device.subjectId,purpose:input.purpose,policyVersion:input.policyVersion,purposeVersion:input.purposeVersion,state:input.action==='grant'?'granted':'revoked'};store.consents.set(consent.id,consent);stopCollectors(device.subjectId);return r.code(202).send({...event,status:'accepted'})}catch(error){if((error as {code?:string})?.code==='CONSENT_OWNER_MISMATCH')return r.code(409).send({error:'permission_owner_mismatch'});if((error as {code?:string})?.code==='CONSENT_STALE_DECISION')return r.code(409).send({error:'stale_consent_decision'});if((error as {code?:string})?.code==='IDEMPOTENCY_CONFLICT')return r.code(409).send({error:'idempotency_key_reused_with_different_request'});q.log.error({err:error},'consent persistence failed');return r.header('retry-after','1').code(503).send({error:'consent_persistence_unavailable',retryable:true})}});
  app.post('/v1/collector/eligibility',async(q,r)=>{let device: Awaited<ReturnType<typeof authenticate>>;try{device=await authenticate(q.headers.authorization, deviceContextHeader(q.headers))}catch(error){q.log.error({err:error},'collector eligibility device authentication unavailable');return r.header('retry-after','1').code(503).send({eligible:false,error:'device_authentication_unavailable',retryable:true})}if(!device)return r.code(401).send({eligible:false,error:'unauthorized'});const parsed=z.object({permissionId:z.string().uuid(),purpose:z.string().min(3).max(120),activationRequested:z.literal(true)}).strict().safeParse(q.body);if(!parsed.success)return r.code(400).send({eligible:false,error:'invalid_request'});try{let current:Consent|null=store.consents.get(parsed.data.permissionId)??null;if(options.consentRepository){const persisted=await options.consentRepository.getCurrent(parsed.data.permissionId);current=persisted?{id:parsed.data.permissionId,decisionId:persisted.decisionId,decisionVersion:persisted.decisionVersion,subjectId:persisted.subjectId,purpose:persisted.purpose,policyVersion:persisted.policyVersion,purposeVersion:persisted.purposeVersion,state:persisted.state}:null}if(!current||current.subjectId!==device.subjectId||current.state!=='granted'||current.purpose!==parsed.data.purpose)return r.code(403).send({eligible:false,error:'active_purpose_consent_required'});// Eligibility is informational only. Capture authorization is rechecked by the protected ingestion transaction below.
const response:{eligible:true;state:'ELIGIBLE';deviceId:string;permissionId:string;purpose:string;activationRequested:true;monitoringDefaultOn:false;decisionId?:string;decisionVersion?:string;policyVersion?:string;purposeVersion?:string}={eligible:true,state:'ELIGIBLE',deviceId:device.id,permissionId:current.id,purpose:current.purpose,activationRequested:parsed.data.activationRequested,monitoringDefaultOn:false};if(current.decisionId)response.decisionId=current.decisionId;if(current.decisionVersion)response.decisionVersion=current.decisionVersion;if(current.policyVersion)response.policyVersion=current.policyVersion;if(current.purposeVersion)response.purposeVersion=current.purposeVersion;return r.code(200).send(response)}catch(error){q.log.error({err:error},'collector eligibility consent check failed');return r.header('retry-after','1').code(503).send({eligible:false,error:'consent_verification_unavailable',retryable:true})}});
  app.get('/v1/consent-events/:permissionId',async(q,r)=>{let device: Awaited<ReturnType<typeof authenticate>>;try{device=await authenticate(q.headers.authorization, deviceContextHeader(q.headers))}catch(error){q.log.error({err:error},'device authentication unavailable');return r.header('retry-after','1').code(503).send({error:'device_authentication_unavailable',retryable:true})}if(!device)return r.code(401).send({error:'unauthorized'});const params=z.object({permissionId:z.string().uuid()}).safeParse(q.params);if(!params.success)return r.code(400).send({error:'invalid_request'});try{if(options.consentRepository){const events=await options.consentRepository.getHistory(params.data.permissionId,device.subjectId);return r.code(200).send({permissionId:params.data.permissionId,events})}const events=store.consentHistory.filter(e=>e.permissionId===params.data.permissionId&&e.subjectId===device.subjectId);return r.code(200).send({permissionId:params.data.permissionId,events})}catch(error){q.log.error({err:error},'consent history read failed');return r.header('retry-after','1').code(503).send({error:'consent_persistence_unavailable',retryable:true})}});
  app.post('/v1/metadata-batches',async(q,r)=>{let device: Awaited<ReturnType<typeof authenticate>>;try{device=await authenticate(q.headers.authorization, deviceContextHeader(q.headers))}catch(error){q.log.error({err:error},'device authentication unavailable');return r.header('retry-after','1').code(503).send({error:'device_authentication_unavailable',retryable:true})}if(!device)return r.code(401).send({error:'unauthorized'});const parsed=batch.safeParse(q.body);if(!parsed.success)return r.code(400).send({error:'invalid_or_non_minimized_metadata',issues:parsed.error.issues});const authRequests=[...new Map(parsed.data.observations.map(item=>[`${item.consentId}|${item.consentPurpose}`,{authenticatedSubject:device.subjectId,deviceId:device.id,consentScope:item.consentId,purpose:item.consentPurpose,requestedOperation:'metadata.ingest' as const}])).values()];const count=parsed.data.observations.length;
  const authorizeAll=async(transaction?:unknown)=>{for(const request of authRequests)await collectorAuth.assertAuthorized(request,transaction)};
  const handleDenied=(error:unknown)=>{if(error instanceof CollectorAuthorizationError){auditDenied('metadata.ingest',device.id,error.result,count,q.log);return sendDenied(r,error.result)}return null};
  if(options.metadataRepository){try{await authorizeAll()}catch(error){const denied=handleDenied(error);if(denied)return denied;throw error}try{const result=await options.metadataRepository.ingestBatch(device,parsed.data,authorizeAll);return r.code(202).send(result)}catch(error){const denied=handleDenied(error);if(denied)return denied;const code=(error as {code?:string})?.code;if(code==='BATCH_REPLAY')return r.code(409).send({error:'replay_detected'});if(code==='ACTIVE_PURPOSE_CONSENT_REQUIRED')return r.code(403).send({error:'active_purpose_consent_required'});if(code==='DEVICE_NOT_ACTIVE')return r.code(401).send({error:'device_not_active'});q.log.error({err:error},'metadata persistence failed');return r.header('retry-after','1').code(503).send({error:'metadata_persistence_unavailable',retryable:true})}}if(store.batches.has(parsed.data.batchId))return r.code(409).send({error:'replay_detected'});const consentAllows=async(item:Observation)=>{let consent:Consent|null=store.consents.get(item.consentId)??null;if(options.consentRepository){const current=await options.consentRepository.getCurrent(item.consentId);consent=current?{id:item.consentId,decisionId:current.decisionId,decisionVersion:current.decisionVersion,subjectId:current.subjectId,purpose:current.purpose,policyVersion:current.policyVersion,purposeVersion:current.purposeVersion,state:current.state}:null}return !!consent&&consent.subjectId===device.subjectId&&consent.state==='granted'&&consent.purpose===item.consentPurpose};for(const item of parsed.data.observations){let allowed:boolean;try{allowed=await consentAllows(item)}catch(error){q.log.error({err:error},'consent verification failed');return r.header('retry-after','1').code(503).send({error:'consent_verification_unavailable',retryable:true})}if(!allowed)return r.code(403).send({error:'active_purpose_consent_required',eventId:item.eventId})}
  try{await authRequests.reduceRight<()=>Promise<void>>((next,request)=>()=>collectorAuth.runAuthorized(request,()=>next()),async()=>{if(store.batches.has(parsed.data.batchId))throw Object.assign(new Error('replay'),{code:'BATCH_REPLAY'});for(const item of parsed.data.observations){const consent=store.consents.get(item.consentId);if(!consent||consent.subjectId!==device.subjectId||consent.state!=='granted'||consent.purpose!==item.consentPurpose)throw Object.assign(new Error('consent'),{code:'ACTIVE_PURPOSE_CONSENT_REQUIRED'})}store.batches.add(parsed.data.batchId);store.observations.push(...parsed.data.observations)})()}catch(error){const denied=handleDenied(error);if(denied)return denied;const code=(error as {code?:string})?.code;if(code==='BATCH_REPLAY')return r.code(409).send({error:'replay_detected'});if(code==='ACTIVE_PURPOSE_CONSENT_REQUIRED')return r.code(403).send({error:'active_purpose_consent_required'});throw error}return r.code(202).send({batchId:parsed.data.batchId,accepted:count})});

  // Intelligence & Value Engine Endpoints
  app.post('/v1/intelligence/events', async (req, reply) => {
    const raw = req.body as Partial<TelemetryEvent>;
    if (!raw || !raw.event_id || !raw.timestamp || !raw.app_id || !raw.device_id || !raw.network) {
      return reply.code(400).send({ error: 'invalid_telemetry_event' });
    }
    const event = raw as TelemetryEvent;
    if (!req.headers.authorization) {
      // Synthetic development fixtures are only accepted when explicitly enabled outside production and never carry device credentials.
      if (!syntheticAllowed) return reply.code(401).send({ error: 'unauthorized' });
      reply.header('x-kicks-event-origin', 'synthetic');
      return reply.code(200).send(engine.processEvent(event));
    }
    let device: Awaited<ReturnType<typeof authenticate>>;
    try { device = await authenticate(req.headers.authorization, deviceContextHeader(req.headers)); }
    catch (error) { req.log.error({ err: error }, 'device authentication unavailable'); return reply.header('retry-after', '1').code(503).send({ error: 'device_authentication_unavailable', retryable: true }); }
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const scope = z.object({ id: z.string().uuid(), purpose: z.string().min(3).max(120) }).safeParse({ id: req.headers['x-kicks-consent-id'], purpose: req.headers['x-kicks-consent-purpose'] });
    const request: CollectorAuthorizationRequest | null = scope.success && event.device_id === device.id
      ? { authenticatedSubject: device.subjectId, deviceId: device.id, consentScope: scope.data.id, purpose: scope.data.purpose, requestedOperation: 'intelligence.ingest' }
      : null;
    if (!request) {
      const result: CollectorAuthorizationResult = { eligible: false, state: 'BLOCKED_NO_CONSENT', reason: 'consent_linkage_or_device_mismatch' };
      auditDenied('intelligence.ingest', device.id, result, 1, req.log);
      return sendDenied(reply, result);
    }
    let view: ReturnType<IntelligenceEngine['processEvent']>;
    try { view = await collectorAuth.runAuthorized(request, async () => engine.processEvent(event)); }
    catch (error) {
      if (error instanceof CollectorAuthorizationError) { auditDenied('intelligence.ingest', device.id, error.result, 1, req.log); return sendDenied(reply, error.result); }
      throw error;
    }
    return reply.code(200).send(view);
  });

  app.get('/v1/intelligence/events/:event_id', async (req, reply) => {
    const { event_id } = req.params as { event_id: string };
    const view = engine.getEvent(event_id);
    if (!view) {
      return reply.code(404).send({ error: 'event_not_found' });
    }
    return reply.code(200).send(view);
  });

  app.get('/v1/intelligence/apps/:app_id/summary', async (req, reply) => {
    const { app_id } = req.params as { app_id: string };
    const { period_start, period_end } = req.query as { period_start?: string; period_end?: string };
    const summary = engine.getAppSummary(app_id, period_start, period_end);
    return reply.code(200).send(summary);
  });

  app.get('/v1/inspector/events/:event_id/metadata', async (req, reply) => {
    const { event_id } = req.params as { event_id: string };
    const view = engine.getEvent(event_id);
    if (!view) {
      return reply.code(404).send({ error: 'event_not_found' });
    }
    return reply.code(200).send(view.metadata_inspection);
  });

  app.get('/v1/inspector/apps/:app_id/gates', async (req, reply) => {
    const { app_id } = req.params as { app_id: string };
    const gates = engine.getGates(app_id);
    return reply.code(200).send(gates);
  });

  app.post('/v1/inspector/apps/:app_id/gates', async (req, reply) => {
    const { app_id } = req.params as { app_id: string };
    const body = req.body as AppMetadataGates;
    if (!body || !Array.isArray(body.gates)) {
      return reply.code(400).send({ error: 'invalid_gates_payload' });
    }
    const updated = engine.updateGates(app_id, body);
    return reply.code(200).send(updated);
  });

  app.post('/v1/marketplace/match', async (req, reply) => {
    const body = req.body as MarketplaceMatchRequest;
    if (!body || !body.app_id) {
      return reply.code(400).send({ error: 'app_id_required' });
    }
    const result = engine.matchMarketplace(body);
    return reply.code(200).send(result);
  });

  // Wallet Mechanic API Endpoints
  app.post('/v1/wallet/events/earn', async (req, reply) => {
    const body = req.body as { event_id?: string; user_id?: string };
    const event_id = body?.event_id ?? `evt-${randomUUID().slice(0, 8)}`;
    const user_id = body?.user_id ?? 'user_demo_01';
    const result = walletEngine.recordEventEarnings(event_id, user_id);
    return reply.code(200).send(result);
  });

  app.get('/v1/wallet/:user_id', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const summary = walletEngine.getSummary(user_id);
    return reply.code(200).send(summary);
  });

  app.get('/v1/wallet/:user_id/ledger', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const { page, page_size } = req.query as { page?: string; page_size?: string };
    const p = page ? Math.max(1, parseInt(page, 10)) : 1;
    const ps = page_size ? Math.min(200, Math.max(1, parseInt(page_size, 10))) : 50;
    const result = walletEngine.getLedger(user_id, p, ps);
    return reply.code(200).send(result);
  });

  app.post('/v1/wallet/:user_id/payout', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const body = req.body as { amount?: number; method?: string };
    const amount = Number(body?.amount ?? 0);
    const method = body?.method ?? 'bank_transfer';
    if (amount <= 0) {
      return reply.code(400).send({ error: 'invalid_amount' });
    }
    const result = walletEngine.requestPayout(user_id, amount, method);
    return reply.code(200).send(result);
  });

  app.get('/v1/wallet/:user_id/progress', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const progress = walletEngine.getProgression(user_id);
    return reply.code(200).send(progress);
  });

  app.get('/v1/wallet/:user_id/apps', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const earnings_by_app = walletEngine.getEarningsByApp(user_id);
    return reply.code(200).send({ earnings_by_app });
  });

  app.get('/v1/wallet/:user_id/metadata', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const earnings_by_metadata = walletEngine.getEarningsByMetadata(user_id);
    return reply.code(200).send({ earnings_by_metadata });
  });

  // Permissions Control API Endpoints
  app.get('/v1/permissions/users/:user_id/apps', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const apps = permissionsEngine.getAppPermissions(user_id);
    return reply.code(200).send({ apps });
  });

  app.post('/v1/permissions/users/:user_id/apps', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const body = req.body as { apps?: AppPermission[] };
    const apps = body?.apps ?? [];
    const updated = permissionsEngine.setAppPermissions(user_id, apps);
    return reply.code(200).send({ apps: updated });
  });

  app.get('/v1/permissions/users/:user_id/apps/:app_id/metadata', async (req, reply) => {
    const { user_id, app_id } = req.params as { user_id: string; app_id: string };
    const metadata_permissions = permissionsEngine.getMetadataPermissions(user_id, app_id);
    return reply.code(200).send({ metadata_permissions });
  });

  app.post('/v1/permissions/users/:user_id/apps/:app_id/metadata', async (req, reply) => {
    const { user_id, app_id } = req.params as { user_id: string; app_id: string };
    const body = req.body as { metadata_permissions?: MetadataPermission[] };
    const metadata_permissions = body?.metadata_permissions ?? [];
    const updated = permissionsEngine.setMetadataPermissions(user_id, app_id, metadata_permissions);
    return reply.code(200).send({ metadata_permissions });
  });

  app.get('/v1/permissions/users/:user_id/buyers', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const buyers = permissionsEngine.getBuyerPermissions(user_id);
    return reply.code(200).send({ buyers });
  });

  app.post('/v1/permissions/users/:user_id/buyers', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const body = req.body as { buyers?: BuyerPermission[] };
    const buyers = body?.buyers ?? [];
    const updated = permissionsEngine.setBuyerPermissions(user_id, buyers);
    return reply.code(200).send({ buyers: updated });
  });

  app.get('/v1/permissions/users/:user_id/effective', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const effective = permissionsEngine.getEffectivePermissions(user_id);
    return reply.code(200).send(effective);
  });

  app.get('/v1/permissions/users/:user_id/consent-log', async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const { page, page_size } = req.query as { page?: string; page_size?: string };
    const p = page ? Math.max(1, parseInt(page, 10)) : 1;
    const ps = page_size ? Math.min(200, Math.max(1, parseInt(page_size, 10))) : 50;
    const result = permissionsEngine.getConsentLog(user_id, p, ps);
    return reply.code(200).send(result);
  });

  app.get('/v1/branding', async (_req, reply) => {
    return reply.code(200).send(KICKS_BRAND_MANIFEST);
  });

  app.get('/v1/branding/mascot', async (_req, reply) => {
    return reply.code(200).send(KICKS_BRAND_MANIFEST);
  });


const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
app.setNotFoundHandler(async (req, reply) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return reply.code(404).send({ error: 'not_found' });
  }
  const staticDirs = [
    resolve(process.cwd(), 'dist'),
    resolve(process.cwd(), 'apps/mobile/dist'),
    resolve(process.cwd(), '../../dist'),
    resolve(process.cwd(), '../../apps/mobile/dist')
  ];
  const staticDir = staticDirs.find(d => existsSync(join(d, 'index.html')));
  if (!staticDir) {
    return reply.code(404).send({ error: 'not_found' });
  }
  const cleanPath = req.url.split('?')[0]?.replace(/^\/+/, '') ?? '';
  const candidate = join(staticDir, cleanPath);
  const targetFile = (cleanPath && existsSync(candidate) && statSync(candidate).isFile())
    ? candidate
    : join(staticDir, 'index.html');
  const ext = extname(targetFile).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  reply.type(contentType);
  return reply.send(createReadStream(targetFile));
});
return app}
