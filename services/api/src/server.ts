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
import { KICKS_BRAND_MANIFEST } from './branding.js';

export * from './intelligence.js';
export * from './wallet.js';
export * from './permissions.js';
export * from './branding.js';

type Device = { id: string; subjectId: string; tokenHash: string; revoked: boolean };
type Consent = {
  permissionId: string;
  activationId: string;
  activationRequestId: string | null;
  subjectId: string;
  deviceId: string;
  purpose: string;
  policyVersion: string;
  purposeVersion: string;
  state: 'granted' | 'revoked';
  occurredAt: string;
};

type CollectionEvent = {
  eventId: string;
  sessionId: string;
  eventType: string;
  occurredAt: string;
  reason: string | null;
  lastHeartbeatAt: string | null;
  appVersion: string;
  deviceId: string;
};

const observation = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  sourceApp: z.string().min(1).max(180).nullable(),
  sourceAppName: z.string().min(1).max(180).nullable().optional(),
  sourceAppCategory: z.string().min(1).max(80).nullable().optional(),
  attribution: z.enum(['verified', 'best_effort', 'unknown']),
  attributionMethod: z.string().max(120).nullable().optional(),
  sourceUid: z.number().int().nonnegative().nullable().optional(),
  attributionFailureReason: z.string().max(160).nullable().optional(),
  attributionSignals: z.array(z.string().max(80)).max(20).optional(),
  attributionLookupAttempts: z.number().int().min(0).max(20).optional(),
  sharedUidPackageCount: z.number().int().min(1).max(100).nullable().optional(),
  appSigningCertificateSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  appInstalledAt: z.string().datetime().nullable().optional(),
  appLastUpdatedAt: z.string().datetime().nullable().optional(),
  isSystemApp: z.boolean().nullable().optional(),
  appVersionName: z.string().max(80).nullable().optional(),
  appVersionCode: z.string().max(40).nullable().optional(),
  destinationHost: z.string().regex(/^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/),
  protocol: z.enum(['dns', 'tcp', 'udp', 'tls', 'quic', 'other']),
  bytesBucket: z.enum(['0-1KB', '1-10KB', '10-100KB', '100KB-1MB', '1MB+']),
  classification: z.enum(['expected', 'review', 'unpermissioned', 'unknown']),
  consentId: z.string().uuid(),
  consentPurpose: z.string().min(3).max(160)
}).strict();

type Observation = z.infer<typeof observation>;

export interface Store {
  devices: Map<string, Device>;
  consents: Map<string, Consent>;
  activationRequests: Map<string, string>;
  batches: Set<string>;
  observations: Observation[];
  collectionEvents: CollectionEvent[];
}

export const memoryStore = (): Store => ({
  devices: new Map(),
  consents: new Map(),
  activationRequests: new Map(),
  batches: new Set(),
  observations: [],
  collectionEvents: []
});

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const decision = z.object({
  permissionId: z.string().uuid(),
  action: z.enum(['grant', 'deny', 'revoke']),
  policyVersion: z.string().min(1).max(64),
  purposeVersion: z.string().min(1).max(64),
  purpose: z.string().min(3).max(160),
  activationRequestId: z.string().uuid().optional(),
  activationId: z.string().uuid().optional()
}).strict();

const batch = z.object({
  batchId: z.string().uuid(),
  schemaVersion: z.literal('2026-09-01'),
  observations: z.array(observation).min(1).max(250)
}).strict();

const collectionEvent = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventType: z.string().min(1).max(80),
  occurredAt: z.string().datetime(),
  reason: z.string().max(240).nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  appVersion: z.string().min(1).max(40)
}).strict();

export function buildServer(options: {
  store?: Store;
  adminSecret?: string;
  intelligenceEngine?: IntelligenceEngine;
  walletEngine?: WalletEngine;
  permissionsEngine?: PermissionsEngine;
} = {}) {
  const store = options.store ?? memoryStore();
  const adminSecret = options.adminSecret ?? process.env.KICKS_STAGING_ADMIN_SECRET ?? '';
  const engine = options.intelligenceEngine ?? new IntelligenceEngine();
  const permissionsEngine = options.permissionsEngine ?? new PermissionsEngine(engine);
  const walletEngine = options.walletEngine ?? new WalletEngine(engine, permissionsEngine);
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.headers.x-admin-secret'] },
    genReqId: () => randomUUID(),
    bodyLimit: 256000
  });

  app.register(cors, { origin: true });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff');
    return payload;
  });
  app.get('/health', async () => ({ status: 'ok', service: 'kicks-api', mode: 'staging', collector: 'metadata-only' }));

  const authenticate = (authorization?: string) => {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) return null;
    const tokenHash = hash(token);
    return [...store.devices.values()].find(device => !device.revoked && equal(device.tokenHash, tokenHash)) ?? null;
  };

  app.post('/v1/staging/devices', async (request, reply) => {
    if (!adminSecret || !equal(hash(String(request.headers['x-admin-secret'] ?? '')), hash(adminSecret))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const parsed = z.object({ subjectId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const token = randomBytes(32).toString('base64url');
    const device: Device = { id: randomUUID(), subjectId: parsed.data.subjectId, tokenHash: hash(token), revoked: false };
    store.devices.set(device.id, device);
    return reply.code(201).send({ deviceId: device.id, token, tokenType: 'Bearer' });
  });

  app.post('/v1/consent-events', async (request, reply) => {
    const device = authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = decision.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const input = parsed.data;
    const now = new Date().toISOString();

    if (input.action === 'grant') {
      if (!input.activationRequestId) return reply.code(400).send({ error: 'activation_request_id_required' });
      const requestKey = `${device.id}:${input.activationRequestId}`;
      const replayActivationId = store.activationRequests.get(requestKey);
      if (replayActivationId) {
        const replay = store.consents.get(replayActivationId);
        if (!replay) return reply.code(409).send({ error: 'activation_replay_state_missing' });
        return reply.code(202).send({
          id: randomUUID(),
          occurredAt: replay.occurredAt,
          ...input,
          activationId: replay.activationId,
          status: 'accepted'
        });
      }

      for (const consent of store.consents.values()) {
        if (consent.deviceId === device.id && consent.permissionId === input.permissionId && consent.state === 'granted') {
          consent.state = 'revoked';
        }
      }

      const activationId = randomUUID();
      const consent: Consent = {
        permissionId: input.permissionId,
        activationId,
        activationRequestId: input.activationRequestId,
        subjectId: device.subjectId,
        deviceId: device.id,
        purpose: input.purpose,
        policyVersion: input.policyVersion,
        purposeVersion: input.purposeVersion,
        state: 'granted',
        occurredAt: now
      };
      store.consents.set(activationId, consent);
      store.activationRequests.set(requestKey, activationId);
      return reply.code(202).send({ id: randomUUID(), occurredAt: now, ...input, activationId, status: 'accepted' });
    }

    if (input.action === 'revoke') {
      if (!input.activationId) return reply.code(400).send({ error: 'activation_id_required' });
      const consent = store.consents.get(input.activationId);
      if (!consent || consent.subjectId !== device.subjectId || consent.deviceId !== device.id || consent.permissionId !== input.permissionId) {
        return reply.code(404).send({ error: 'activation_not_found' });
      }
      consent.state = 'revoked';
      return reply.code(202).send({ id: randomUUID(), occurredAt: now, ...input, activationId: consent.activationId, status: 'accepted' });
    }

    return reply.code(202).send({ id: randomUUID(), occurredAt: now, ...input, status: 'accepted' });
  });

  app.post('/v1/metadata-batches', async (request, reply) => {
    const device = authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = batch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_or_non_minimized_metadata', issues: parsed.error.issues });
    if (store.batches.has(parsed.data.batchId)) return reply.code(409).send({ error: 'replay_detected' });

    for (const item of parsed.data.observations) {
      const consent = store.consents.get(item.consentId);
      if (!consent || consent.subjectId !== device.subjectId || consent.deviceId !== device.id || consent.state !== 'granted' || consent.purpose !== item.consentPurpose) {
        return reply.code(403).send({ error: 'active_purpose_consent_required', eventId: item.eventId });
      }
    }

    store.batches.add(parsed.data.batchId);
    store.observations.push(...parsed.data.observations);
    return reply.code(202).send({ batchId: parsed.data.batchId, accepted: parsed.data.observations.length });
  });

  app.post('/v1/collection-events', async (request, reply) => {
    const device = authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = collectionEvent.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_collection_event', issues: parsed.error.issues });
    store.collectionEvents.push({ ...parsed.data, deviceId: device.id });
    return reply.code(202).send({ eventId: parsed.data.eventId, status: 'accepted' });
  });

  app.get('/v1/me/engine', async (request, reply) => {
    const device = authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const limitRaw = Number((request.query as { limit?: string }).limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 50;
    const activeConsent = [...store.consents.values()]
      .filter(consent => consent.deviceId === device.id && consent.subjectId === device.subjectId && consent.state === 'granted')
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] ?? null;
    const observations = store.observations
      .filter(item => store.consents.get(item.consentId)?.deviceId === device.id)
      .slice(-limit)
      .reverse();
    const distinctDomains = new Set(observations.map(item => item.destinationHost)).size;
    const attributedApps = new Set(observations.map(item => item.sourceApp).filter((value): value is string => Boolean(value))).size;
    const review = observations.filter(item => item.classification === 'review' || item.classification === 'unpermissioned').length;

    return reply.code(200).send({
      generatedAt: new Date().toISOString(),
      metrics: { observations: observations.length, distinctDomains, review, attributedApps },
      consent: {
        permissionId: activeConsent?.activationId ?? null,
        purpose: activeConsent?.purpose ?? null,
        status: activeConsent ? 'active' : 'missing',
        updatedAt: activeConsent?.occurredAt ?? null
      },
      lastObservationAt: observations[0]?.occurredAt ?? null,
      observations: observations.map(item => ({
        observationId: item.eventId,
        observedAt: item.occurredAt,
        lastObservedAt: item.occurredAt,
        destinationDomain: item.destinationHost,
        destinationHost: item.destinationHost,
        sourceApp: item.sourceApp,
        sourceAppName: item.sourceAppName ?? null,
        company: item.destinationHost,
        purpose: item.consentPurpose,
        dataCategory: 'network metadata',
        commercialFunction: 'unknown',
        behaviorTier: item.classification === 'review' || item.classification === 'unpermissioned' ? 'unexpected' : 'unknown',
        plainLanguageSummary: `${item.sourceAppName ?? item.sourceApp ?? 'An app'} contacted ${item.destinationHost}.`,
        confidence: item.attribution === 'verified' ? 100 : item.attribution === 'best_effort' ? 70 : 0,
        frequency: 1,
        protocol: item.protocol,
        bytesBucket: item.bytesBucket,
        consentStatus: activeConsent && activeConsent.activationId === item.consentId ? 'active' : 'inactive',
        consentPurpose: item.consentPurpose,
        compensationEligible: false,
        valuePotential: 'not_assessed',
        buyerCategory: null,
        eligibilityReason: 'No verified buyer match is attached to this observation.'
      }))
    });
  });

  app.post('/v1/intelligence/events', async (request, reply) => {
    const raw = request.body as Partial<TelemetryEvent>;
    if (!raw || !raw.event_id || !raw.timestamp || !raw.app_id || !raw.device_id || !raw.network) return reply.code(400).send({ error: 'invalid_telemetry_event' });
    return reply.code(200).send(engine.processEvent(raw as TelemetryEvent));
  });

  app.get('/v1/intelligence/events/:event_id', async (request, reply) => {
    const { event_id } = request.params as { event_id: string };
    const view = engine.getEvent(event_id);
    return view ? reply.code(200).send(view) : reply.code(404).send({ error: 'event_not_found' });
  });

  app.get('/v1/intelligence/apps/:app_id/summary', async (request, reply) => {
    const { app_id } = request.params as { app_id: string };
    const { period_start, period_end } = request.query as { period_start?: string; period_end?: string };
    return reply.code(200).send(engine.getAppSummary(app_id, period_start, period_end));
  });

  app.get('/v1/inspector/events/:event_id/metadata', async (request, reply) => {
    const { event_id } = request.params as { event_id: string };
    const view = engine.getEvent(event_id);
    return view ? reply.code(200).send(view.metadata_inspection) : reply.code(404).send({ error: 'event_not_found' });
  });

  app.get('/v1/inspector/apps/:app_id/gates', async (request, reply) => {
    const { app_id } = request.params as { app_id: string };
    return reply.code(200).send(engine.getGates(app_id));
  });

  app.post('/v1/inspector/apps/:app_id/gates', async (request, reply) => {
    const { app_id } = request.params as { app_id: string };
    const body = request.body as AppMetadataGates;
    if (!body || !Array.isArray(body.gates)) return reply.code(400).send({ error: 'invalid_gates_payload' });
    return reply.code(200).send(engine.updateGates(app_id, body));
  });

  app.post('/v1/marketplace/match', async (request, reply) => {
    const body = request.body as MarketplaceMatchRequest;
    if (!body || !body.app_id) return reply.code(400).send({ error: 'app_id_required' });
    return reply.code(200).send(engine.matchMarketplace(body));
  });

  app.post('/v1/wallet/events/earn', async (request, reply) => {
    const body = request.body as { event_id?: string; user_id?: string };
    if (!body?.event_id || !body?.user_id?.trim()) return reply.code(400).send({ error: 'event_id_and_user_id_required' });
    try {
      return reply.code(200).send(walletEngine.recordEventEarnings(body.event_id, body.user_id));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'earning_not_recorded';
      return reply.code(code === 'event_not_found' ? 404 : 409).send({ error: code });
    }
  });

  app.get('/v1/wallet/:user_id', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send(walletEngine.getSummary(user_id));
  });

  app.get('/v1/wallet/:user_id/ledger', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    const { page, page_size } = request.query as { page?: string; page_size?: string };
    const p = page ? Math.max(1, parseInt(page, 10)) : 1;
    const ps = page_size ? Math.min(200, Math.max(1, parseInt(page_size, 10))) : 50;
    return reply.code(200).send(walletEngine.getLedger(user_id, p, ps));
  });

  app.post('/v1/wallet/:user_id/payout', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    const body = request.body as { amount?: number; method?: string };
    const amount = Number(body?.amount ?? 0);
    const method = body?.method?.trim() ?? '';
    if (amount <= 0 || !method) return reply.code(400).send({ error: 'valid_amount_and_method_required' });
    const result = walletEngine.requestPayout(user_id, amount, method);
    return reply.code(result.permitted ? 202 : 409).send(result);
  });

  app.get('/v1/wallet/:user_id/progress', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send(walletEngine.getProgression(user_id));
  });

  app.get('/v1/wallet/:user_id/apps', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send({ earnings_by_app: walletEngine.getEarningsByApp(user_id) });
  });

  app.get('/v1/wallet/:user_id/metadata', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send({ earnings_by_metadata: walletEngine.getEarningsByMetadata(user_id) });
  });

  app.get('/v1/permissions/users/:user_id/apps', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send({ apps: permissionsEngine.getAppPermissions(user_id) });
  });

  app.post('/v1/permissions/users/:user_id/apps', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    const body = request.body as { apps?: AppPermission[] };
    return reply.code(200).send({ apps: permissionsEngine.setAppPermissions(user_id, body?.apps ?? []) });
  });

  app.get('/v1/permissions/users/:user_id/apps/:app_id/metadata', async (request, reply) => {
    const { user_id, app_id } = request.params as { user_id: string; app_id: string };
    return reply.code(200).send({ metadata_permissions: permissionsEngine.getMetadataPermissions(user_id, app_id) });
  });

  app.post('/v1/permissions/users/:user_id/apps/:app_id/metadata', async (request, reply) => {
    const { user_id, app_id } = request.params as { user_id: string; app_id: string };
    const body = request.body as { metadata_permissions?: MetadataPermission[] };
    return reply.code(200).send({ metadata_permissions: permissionsEngine.setMetadataPermissions(user_id, app_id, body?.metadata_permissions ?? []) });
  });

  app.get('/v1/permissions/users/:user_id/buyers', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send({ buyers: permissionsEngine.getBuyerPermissions(user_id) });
  });

  app.post('/v1/permissions/users/:user_id/buyers', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    const body = request.body as { buyers?: BuyerPermission[] };
    return reply.code(200).send({ buyers: permissionsEngine.setBuyerPermissions(user_id, body?.buyers ?? []) });
  });

  app.get('/v1/permissions/users/:user_id/effective', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    return reply.code(200).send(permissionsEngine.getEffectivePermissions(user_id));
  });

  app.get('/v1/permissions/users/:user_id/consent-log', async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    const { page, page_size } = request.query as { page?: string; page_size?: string };
    const p = page ? Math.max(1, parseInt(page, 10)) : 1;
    const ps = page_size ? Math.min(200, Math.max(1, parseInt(page_size, 10))) : 50;
    return reply.code(200).send(permissionsEngine.getConsentLog(user_id, p, ps));
  });

  app.get('/v1/branding', async (_request, reply) => reply.code(200).send(KICKS_BRAND_MANIFEST));
  app.get('/v1/branding/mascot', async (_request, reply) => reply.code(200).send(KICKS_BRAND_MANIFEST));

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

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(404).send({ error: 'not_found' });
    const staticDirs = [
      resolve(process.cwd(), 'dist'),
      resolve(process.cwd(), 'apps/mobile/dist'),
      resolve(process.cwd(), '../../dist'),
      resolve(process.cwd(), '../../apps/mobile/dist')
    ];
    const staticDir = staticDirs.find(directory => existsSync(join(directory, 'index.html')));
    if (!staticDir) return reply.code(404).send({ error: 'not_found' });
    const cleanPath = request.url.split('?')[0]?.replace(/^\/+/, '') ?? '';
    const candidate = join(staticDir, cleanPath);
    const targetFile = cleanPath && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(staticDir, 'index.html');
    reply.type(MIME_TYPES[extname(targetFile).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(targetFile));
  });

  return app;
}
