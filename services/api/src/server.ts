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

type Device={id:string;subjectId:string;tokenHash:string;revoked:boolean};type Consent={id:string;subjectId:string;purpose:string;policyVersion:string;purposeVersion:string;state:'granted'|'revoked'};
const observation=z.object({eventId:z.string().uuid(),occurredAt:z.string().datetime(),sourceApp:z.string().min(1).max(180).nullable(),attribution:z.enum(['verified','best_effort','unknown']),destinationHost:z.string().regex(/^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/),protocol:z.enum(['dns','tcp','udp','tls','quic','other']),bytesBucket:z.enum(['0-1KB','1-10KB','10-100KB','100KB-1MB','1MB+']),classification:z.enum(['expected','review','unpermissioned','unknown']),consentId:z.string().uuid(),consentPurpose:z.string().min(3).max(120)}).strict();
type Observation=z.infer<typeof observation>;export interface Store{devices:Map<string,Device>;consents:Map<string,Consent>;batches:Set<string>;observations:Observation[]};export const memoryStore=():Store=>({devices:new Map(),consents:new Map(),batches:new Set(),observations:[]});
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const decision=z.object({permissionId:z.string().uuid(),action:z.enum(['grant','deny','revoke']),policyVersion:z.string().min(1).max(64),purposeVersion:z.string().min(1).max(64),purpose:z.string().min(3).max(120)}).strict();
const batch=z.object({batchId:z.string().uuid(),schemaVersion:z.literal('2026-08-01'),observations:z.array(observation).min(1).max(250)}).strict();

export function buildServer(options:{store?:Store;adminSecret?:string;intelligenceEngine?:IntelligenceEngine;walletEngine?:WalletEngine;permissionsEngine?:PermissionsEngine}={}){
  const store=options.store??memoryStore();
  const adminSecret=options.adminSecret??process.env.KICKS_STAGING_ADMIN_SECRET??'';
  const engine = options.intelligenceEngine ?? new IntelligenceEngine();
  const permissionsEngine = options.permissionsEngine ?? new PermissionsEngine(engine);
  const walletEngine = options.walletEngine ?? new WalletEngine(engine, permissionsEngine);
  const app=Fastify({logger:{redact:['req.headers.authorization','req.headers.x-admin-secret']},genReqId:()=>randomUUID(),bodyLimit:256000});
  app.register(cors,{origin:true});
  app.addHook('onSend',async(_q,r,p)=>{r.header('cache-control','no-store').header('x-content-type-options','nosniff');return p});
  app.get('/health',async()=>({status:'ok',service:'kicks-api',mode:'staging',collector:'metadata-only'}));

  const authenticate=(authorization?:string)=>{const[scheme,token]=authorization?.split(' ')??[];if(scheme!=='Bearer'||!token)return null;const tokenHash=hash(token);return[...store.devices.values()].find(d=>!d.revoked&&equal(d.tokenHash,tokenHash))??null};
  app.post('/v1/staging/devices',async(q,r)=>{if(!adminSecret||!equal(hash(String(q.headers['x-admin-secret']??'')),hash(adminSecret)))return r.code(403).send({error:'forbidden'});const parsed=z.object({subjectId:z.string().uuid()}).strict().safeParse(q.body);if(!parsed.success)return r.code(400).send({error:'invalid_request'});const token=randomBytes(32).toString('base64url'),device:Device={id:randomUUID(),subjectId:parsed.data.subjectId,tokenHash:hash(token),revoked:false};store.devices.set(device.id,device);return r.code(201).send({deviceId:device.id,token,tokenType:'Bearer'})});
  app.post('/v1/consent-events',async(q,r)=>{const device=authenticate(q.headers.authorization);if(!device)return r.code(401).send({error:'unauthorized'});const parsed=decision.safeParse(q.body);if(!parsed.success)return r.code(400).send({error:'invalid_request',issues:parsed.error.issues});const consent:Consent={id:parsed.data.permissionId,subjectId:device.subjectId,purpose:parsed.data.purpose,policyVersion:parsed.data.policyVersion,purposeVersion:parsed.data.purposeVersion,state:parsed.data.action==='grant'?'granted':'revoked'};store.consents.set(consent.id,consent);return r.code(202).send({id:randomUUID(),occurredAt:new Date().toISOString(),...parsed.data,status:'accepted'})});
  app.post('/v1/metadata-batches',async(q,r)=>{const device=authenticate(q.headers.authorization);if(!device)return r.code(401).send({error:'unauthorized'});const parsed=batch.safeParse(q.body);if(!parsed.success)return r.code(400).send({error:'invalid_or_non_minimized_metadata',issues:parsed.error.issues});if(store.batches.has(parsed.data.batchId))return r.code(409).send({error:'replay_detected'});for(const item of parsed.data.observations){const consent=store.consents.get(item.consentId);if(!consent||consent.subjectId!==device.subjectId||consent.state!=='granted'||consent.purpose!==item.consentPurpose)return r.code(403).send({error:'active_purpose_consent_required',eventId:item.eventId})}store.batches.add(parsed.data.batchId);store.observations.push(...parsed.data.observations);return r.code(202).send({batchId:parsed.data.batchId,accepted:parsed.data.observations.length})});

  // Intelligence & Value Engine Endpoints
  app.post('/v1/intelligence/events', async (req, reply) => {
    const raw = req.body as Partial<TelemetryEvent>;
    if (!raw || !raw.event_id || !raw.timestamp || !raw.app_id || !raw.device_id || !raw.network) {
      return reply.code(400).send({ error: 'invalid_telemetry_event' });
    }
    const event = raw as TelemetryEvent;
    const view = engine.processEvent(event);
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
    return reply.code(200).send({ metadata_permissions: updated });
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
