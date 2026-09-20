import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { z } from 'zod';
import { endpointBySignatureId } from './endpoint-intelligence.js';
import { InverseGrowthEngine } from './inverse-growth.js';
import { InversePricingEngine } from './inverse-pricing.js';
import { AppMetadataGates, IntelligenceEngine, MarketplaceMatchRequest, TelemetryEvent } from './intelligence.js';
import { WalletEngine } from './wallet.js';
import { ComplianceEngine, type CompliancePolicy } from './compliance.js';
import { BlogComplianceGateway } from './blog-compliance-gateway.js';
import { MemoryConsumerIdentityStore, type ConsumerIdentityStore } from './consumer-identity.js';
import { PostgresConsumerIdentityStore } from './consumer-identity-postgres.js';
import {
  MemoryConsumerDeviceBindingStore,
  PostgresConsumerDeviceBindingStore,
  type ConsumerDeviceBindingStore,
} from './consumer-device-bindings.js';
import { registerDataStormIdentityRoutes } from './datastorm-identity-routes.js';
import { registerKicksConsumerRoutes } from './kicks-consumer-routes.js';
import { KICKS_BRAND_MANIFEST } from './branding.js';
import { resolveRuntimeEnvironment, validateProductionRuntimeConfig } from './production-config.js';
import { AppPermission, BuyerPermission, MetadataPermission, PermissionsEngine } from './permissions.js';
import {
  governEngineSnapshot,
  type EngineMode,
  type ProductionReadiness,
} from './engine-policy.js';
import {
  MemoryStore,
  PostgresStore,
  safeEqual,
  type AuditEvent,
  type AppCategory,
  type Observation,
  type Store,
} from './store.js';

export { MemoryStore, type Store } from './store.js';
export const memoryStore = () => new MemoryStore();

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const glyphId = (kind: 'device' | 'consent' | 'activation') => 'glyph_' + kind + '_' + randomBytes(12).toString('hex');
const attributionSignal = z.enum([
  'dns_query',
  'socket_owner_uid',
  'package_uid_mapping',
  'shared_uid_mapping',
  'package_metadata',
  'signing_certificate',
]);
const attributionFailureReason = z.enum([
  'api_below_29',
  'connection_not_found',
  'package_not_visible',
  'shared_uid',
  'package_metadata_unavailable',
  'lookup_error',
]);
const observation = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  sourceApp: z.string().min(1).max(180).nullable(),
  sourceAppName: z.string().min(1).max(120).nullable().optional(),
  sourceAppCategory: z.string().min(1).max(80).nullable().optional(),
  attribution: z.enum(['verified', 'best_effort', 'unknown']),
  attributionMethod: z.enum(['android_connection_owner_uid']).nullable().optional(),
  sourceUid: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  attributionFailureReason: attributionFailureReason.nullable().optional(),
  attributionSignals: z.array(attributionSignal).max(8).default([]),
  attributionLookupAttempts: z.number().int().min(0).max(3).default(0),
  sharedUidPackageCount: z.number().int().min(2).max(100).nullable().optional(),
  appSigningCertificateSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  endpointSignatureId: z.string().uuid().nullable().optional(),
  appInstalledAt: z.string().datetime().nullable().optional(),
  appLastUpdatedAt: z.string().datetime().nullable().optional(),
  isSystemApp: z.boolean().nullable().optional(),
  appVersionName: z.string().min(1).max(80).nullable().optional(),
  appVersionCode: z.string().min(1).max(32).nullable().optional(),
  destinationHost: z.string().regex(/^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/),
  protocol: z.enum(['dns', 'tcp', 'udp', 'tls', 'quic', 'other']),
  bytesBucket: z.enum(['0-1KB', '1-10KB', '10-100KB', '100KB-1MB', '1MB+']),
  classification: z.enum(['expected', 'review', 'unpermissioned', 'unknown']),
  consentId: z.string().uuid(),
  consentPurpose: z.string().min(3).max(120),
}).strict().superRefine((value, context) => {
  if (value.endpointSignatureId && value.protocol === 'dns') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endpointSignatureId'],
      message: 'DNS observations cannot claim endpoint evidence.',
    });
  }
});
const decision = z.object({
  permissionId: z.string().uuid(),
  activationRequestId: z.string().uuid().optional(),
  action: z.enum(['grant', 'deny', 'revoke']),
  policyVersion: z.string().min(1).max(64),
  purposeVersion: z.string().min(1).max(64),
  purpose: z.string().min(3).max(120),
}).strict();
const batch = z.object({
  batchId: z.string().uuid(),
  schemaVersion: z.enum(['2026-08-01', '2026-08-20', '2026-08-21', '2026-09-01', '2026-09-02']),
  observations: z.array(observation).min(1).max(250),
}).strict().superRefine((value, context) => {
  if (value.schemaVersion !== '2026-09-02'
    && value.observations.some(item => item.endpointSignatureId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schemaVersion'],
      message: 'Endpoint evidence requires the 2026-09-02 contract.',
    });
  }
});
const collectionEvent = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  eventType: z.enum(['session_started', 'heartbeat', 'session_stopped', 'vpn_revoked', 'crash_detected']),
  occurredAt: z.string().datetime(),
  reason: z.string().min(1).max(160).nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  appVersion: z.string().min(1).max(32),
}).strict();
const engineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const idParam=z.object({id:z.string().uuid()}).strict();
const feedbackInput=z.object({targetType:z.enum(['explanation','opportunity','receipt']),targetId:z.string().uuid(),rating:z.enum(['correct','incorrect','unclear','need_help']),comment:z.string().max(1000).nullable().optional()}).strict();
const appealInput=z.object({targetType:z.enum(['classification','opportunity','valuation','fee','payment','deletion']),targetId:z.string().uuid(),reason:z.string().min(10).max(2000)}).strict();
const inverseSignals = z.object({
  PRI: z.number().min(0).max(1), BDI: z.number().min(0).max(1),
  SSI: z.number().min(0).max(1), MRI: z.number().min(0).max(1), QLI: z.number().min(0).max(1),
}).strict();
const inverseFormula = z.object({
  beta: z.number().min(0).max(8), gamma: z.number().min(0).max(8),
  delta: z.number().min(0).max(8), epsilon: z.number().min(0).max(8),
}).strict();
const pricingFormula = inverseFormula.extend({
  maxUplift: z.number().min(0).max(2), version: z.string().min(1).max(64),
}).strict();
const valuationInput = z.object({
  referencePrice: z.number().positive().max(1_000_000), upliftFactor: z.number().min(0).max(2),
  signals: inverseSignals, consentAuthorized: z.boolean(), buyerAuthorized: z.boolean(),
}).strict();

export function buildServer(options: {
  store?: Store;
  adminSecret?: string;
  environment?: 'staging' | 'production';
  requestedEngineMode?: EngineMode;
  manualProductionApproval?: boolean;
  productionReadiness?: Partial<ProductionReadiness>;
  compensationExecutionEnabled?: boolean;
  anomalyTruePositiveRate?: number | null;
  intelligenceEngine?: IntelligenceEngine;
  walletEngine?: WalletEngine;
  permissionsEngine?: PermissionsEngine;
  complianceEngine?: ComplianceEngine;
  blogComplianceGateway?: BlogComplianceGateway;
  consumerIdentityStore?: ConsumerIdentityStore;
  consumerDeviceBindingStore?: ConsumerDeviceBindingStore;
} = {}) {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.KICKS_DATABASE_URL;
  const environment = resolveRuntimeEnvironment({
    nodeEnvironment: process.env.NODE_ENV,
    kicksEnvironment: options.environment ?? process.env.KICKS_ENVIRONMENT,
  });
  validateProductionRuntimeConfig({
    environment,
    databaseUrl,
    publicApiUrl: process.env.KICKS_PUBLIC_API_URL,
  });
  const store = options.store ?? (databaseUrl
    ? PostgresStore.fromConnectionString(databaseUrl)
    : new MemoryStore());
  const requestedEngineMode = options.requestedEngineMode ?? normalizeEngineMode(process.env.KICKS_ENGINE_MODE, environment);
  const manualProductionApproval = options.manualProductionApproval
    ?? process.env.KICKS_ENGINE_MANUAL_OVERRIDE === 'production';
  const productionReadiness = resolveProductionReadiness(options.productionReadiness);
  const compensationExecutionEnabled = options.compensationExecutionEnabled
    ?? process.env.KICKS_COMPENSATION_EXECUTION_ENABLED === 'true';
  const anomalyTruePositiveRate = options.anomalyTruePositiveRate ?? null;
  const adminSecret = options.adminSecret ?? process.env.KICKS_STAGING_ADMIN_SECRET ?? '';
  const inverseGrowth = new InverseGrowthEngine();
  const inversePricing = new InversePricingEngine();
  const engine = options.intelligenceEngine ?? new IntelligenceEngine();
  const permissionsEngine = options.permissionsEngine ?? new PermissionsEngine(engine);
  const walletEngine = options.walletEngine ?? new WalletEngine(engine, permissionsEngine);
  const complianceEngine = options.complianceEngine ?? new ComplianceEngine();
  const blogComplianceGateway = options.blogComplianceGateway ?? new BlogComplianceGateway(complianceEngine);
  const identityStore = options.consumerIdentityStore ?? (databaseUrl
    ? PostgresConsumerIdentityStore.fromConnectionString(databaseUrl)
    : new MemoryConsumerIdentityStore());
  const deviceBindingStore = options.consumerDeviceBindingStore ?? (databaseUrl
    ? PostgresConsumerDeviceBindingStore.fromConnectionString(databaseUrl)
    : new MemoryConsumerDeviceBindingStore());
  const app = Fastify({
    logger: { redact: [
      'req.headers.authorization',
      'req.headers.x-admin-secret',
      'req.headers.cf-access-client-id',
      'req.headers.cf-access-client-secret',
    ] },
    genReqId: () => randomUUID(),
    bodyLimit: 256000,
  });

  app.register(cors, { origin: false });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('strict-transport-security', 'max-age=31536000');
    return payload;
  });
  app.addHook('onClose', async () => {
    await Promise.all([store.close(), identityStore.close(), deviceBindingStore.close()]);
  });

  app.get('/health', async () => ({
    status: 'ok', service: 'kicks-api', environment, collector: 'metadata-only',
    durability: store instanceof PostgresStore ? 'postgres' : 'memory',
    enginePolicyVersion: '1.0.0', configuredEngineMode: requestedEngineMode,
  }));

  registerDataStormIdentityRoutes(app, identityStore);
  registerKicksConsumerRoutes(app, {
    identityStore,
    deviceBindingStore,
    store,
    permissionsEngine,
    walletEngine,
    complianceEngine,
  });

  const authenticateAdmin = (suppliedSecret: string) => Boolean(adminSecret)
    && safeEqual(hash(suppliedSecret), hash(adminSecret));

  app.get('/v1/admin/control-center', async (request, reply) => {
    const suppliedSecret = String(request.headers['x-admin-secret'] ?? '');
    if (!authenticateAdmin(suppliedSecret)) return reply.code(403).send({ error: 'forbidden' });
    const snapshot = await store.adminControlCenterSnapshot();
    return {
      ...snapshot,
      inverseEngines: {
        growth: inverseGrowth.summary(),
        pricing: inversePricing.adminSnapshot(),
      },
      environment: {
        name: environment,
        databaseDurability: store instanceof PostgresStore ? 'PostgreSQL' : 'Memory',
        enginePolicyVersion: '1.0.0',
        configuredEngineMode: requestedEngineMode,
        compensationEnabled: compensationExecutionEnabled,
      },
    };
  });

  const authenticate = async (authorization?: string) => {
    const [scheme, token] = authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? store.findDeviceByTokenHash(hash(token)) : null;
  };
  const audit = (event: Omit<AuditEvent, 'id' | 'occurredAt'>) => store.appendAudit({
    id: randomUUID(), occurredAt: new Date().toISOString(), ...event,
  });

  app.post('/v1/behavior/events', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ session_id: z.string().uuid(), event_type: z.string().min(1).max(80), timestamp: z.string().datetime() }).passthrough().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const event = inverseGrowth.captureBehavior(device.subjectId, parsed.data.event_type, parsed.data.timestamp);
    return reply.code(202).send({ status: 'accepted', event_id: event.id });
  });

  app.post('/v1/signals/generate', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ window: z.enum(['7d', '30d']), signals: inverseSignals }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return { subject_id: device.subjectId, signals: inverseGrowth.generateSignals(parsed.data.signals), version: 'growth-signals-1.0.0', status: 'research_input' };
  });

  app.post('/v1/outcomes/capture', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = z.object({ timestamp: z.string().datetime(), outcomes: z.object({ engagement_score: z.number().min(0).max(1) }).passthrough() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const outcome = inverseGrowth.captureOutcome(device.subjectId, parsed.data.outcomes.engagement_score, parsed.data.timestamp);
    return { status: 'recorded', outcome_id: outcome.id };
  });

  app.get('/v1/admin/dashboard/summary', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    return { growth: inverseGrowth.summary(), pricing: inversePricing.adminSnapshot(), generatedAt: new Date().toISOString() };
  });

  app.get('/v1/admin/parameters/current', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    return inverseGrowth.currentFormula();
  });

  app.post('/v1/admin/parameters/simulate', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z.object({ hypothetical_formula: inverseFormula, signals: z.array(inverseSignals).max(10_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return { hypothetical_formula: parsed.data.hypothetical_formula, projected_metrics: inverseGrowth.simulate(parsed.data.hypothetical_formula, parsed.data.signals) };
  });

  app.post('/v1/admin/parameters/apply', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z.object({ proposed_formula: inverseFormula, rationale: z.string().min(10).max(2_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const proposal = inverseGrowth.propose(parsed.data.proposed_formula, parsed.data.rationale);
    return reply.code(202).send({ status: 'accepted_for_review', change_request_id: proposal.id });
  });

  app.post('/v1/valuation/quote', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = valuationInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return { subject_id: device.subjectId, ...inversePricing.quote(parsed.data) };
  });

  app.post('/v1/valuation/batch', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z.object({ batch_id: z.string().uuid(), items: z.array(valuationInput).min(1).max(1_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return { batch_id: parsed.data.batch_id, results: parsed.data.items.map((item) => inversePricing.quote(item)) };
  });

  app.post('/v1/simulation/run', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z.object({ hypothetical_formula: pricingFormula, inputs: z.array(valuationInput).max(10_000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return { hypothetical_formula: parsed.data.hypothetical_formula, projected_metrics: inversePricing.simulate(parsed.data.hypothetical_formula, parsed.data.inputs) };
  });

  app.get('/v1/parameters/current', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    return inversePricing.currentFormula();
  });

  app.post('/v1/parameters/propose', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    const parsed = z.object({ proposed_formula: pricingFormula, rationale: z.string().min(10).max(2_000), submitted_by: z.string().min(1).max(120) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(202).send(inversePricing.propose(parsed.data.proposed_formula, parsed.data.submitted_by, parsed.data.rationale));
  });

  app.get('/v1/governance/audit-log', async (request, reply) => {
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    return { entries: inversePricing.adminSnapshot().auditEntries };
  });

  app.post('/v1/staging/devices', async (request, reply) => {
    if (environment === 'production') return reply.code(404).send({ error: 'not_found' });
    const suppliedSecret = String(request.headers['x-admin-secret'] ?? '');
    if (!authenticateAdmin(suppliedSecret)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const parsed = z.object({ subjectId: z.string().uuid(), appVersion: z.string().max(32).optional() })
      .strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const token = randomBytes(32).toString('base64url');
    const device = { id: randomUUID(), subjectId: parsed.data.subjectId, tokenHash: hash(token), revoked: false };
    await store.createDevice({ ...device, environment, appVersion: parsed.data.appVersion });
    await audit({ actorId: device.subjectId, action: 'device.enroll', targetType: 'device', targetId: device.id,
      outcome: 'accepted', correlationId: request.id, metadata: { environment } });
    return reply.code(201).send({ deviceId: device.id, token, tokenType: 'Bearer' });
  });

  app.post('/v1/consent-events', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = decision.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });

    if (parsed.data.activationRequestId) {
      const replay = await store.consentByActivationRequest(device.id, parsed.data.activationRequestId);
      if (replay) {
        return reply.code(200).send({
          id: replay.id,
          activationId: replay.activationId,
          vaultId: replay.vaultId,
          activationVaultId: replay.activationVaultId,
          occurredAt: replay.occurredAt,
          permissionId: replay.permissionId,
          action: replay.action,
          policyVersion: replay.policyVersion,
          purposeVersion: replay.purposeVersion,
          purpose: replay.purpose,
          status: 'accepted',
          replayed: true,
        });
      }
    }

    const activationId = parsed.data.action === 'grant' ? randomUUID() : null;
    const event = {
      id: randomUUID(),
      deviceId: device.id,
      subjectId: device.subjectId,
      permissionId: parsed.data.permissionId,
      action: parsed.data.action,
      policyVersion: parsed.data.policyVersion,
      purposeVersion: parsed.data.purposeVersion,
      purpose: parsed.data.purpose,
      activationRequestId: parsed.data.activationRequestId ?? null,
      activationId,
      vaultId: glyphId('consent'),
      activationVaultId: activationId ? glyphId('activation') : null,
      occurredAt: new Date().toISOString(),
      correlationId: request.id,
    };

    await store.appendConsent(event);
    await audit({
      actorId: device.subjectId,
      action: `consent.${parsed.data.action}`,
      targetType: 'permission',
      targetId: parsed.data.permissionId,
      outcome: 'accepted',
      correlationId: request.id,
      metadata: {
        purpose: parsed.data.purpose,
        policyVersion: parsed.data.policyVersion,
        purposeVersion: parsed.data.purposeVersion,
        activationId,
      },
    });

    return reply.code(202).send({
      id: event.id,
      activationId: event.activationId,
      vaultId: event.vaultId,
      activationVaultId: event.activationVaultId,
      occurredAt: event.occurredAt,
      permissionId: event.permissionId,
      action: event.action,
      policyVersion: event.policyVersion,
      purposeVersion: event.purposeVersion,
      purpose: event.purpose,
      status: 'accepted',
      replayed: false,
    });
  });

  app.post('/v1/metadata-batches', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = batch.safeParse(request.body);
    if (!parsed.success) {
      await audit({ actorId: device.subjectId, action: 'metadata.ingest', targetType: 'batch', targetId: null,
        outcome: 'rejected', correlationId: request.id, metadata: { reason: 'non_minimized' } });
      return reply.code(400).send({ error: 'invalid_or_non_minimized_metadata', issues: parsed.error.issues });
    }
    if (await store.hasBatch(parsed.data.batchId)) return reply.code(409).send({ error: 'replay_detected' });
    for (const item of parsed.data.observations) {
      const consent = await store.consentByActivationId(device.id, item.consentId);
      const current = consent ? await store.currentConsent(device.id, device.subjectId, consent.permissionId) : null;
      if (!consent || !current || current.id !== consent.id || consent.action !== 'grant' || consent.purpose !== item.consentPurpose) {
        await audit({ actorId: device.subjectId, action: 'metadata.ingest', targetType: 'batch',
          targetId: parsed.data.batchId, outcome: 'denied', correlationId: request.id,
          metadata: { reason: 'consent_required', eventId: item.eventId } });
        return reply.code(403).send({ error: 'active_purpose_consent_required', eventId: item.eventId });
      }
      if (item.endpointSignatureId && !endpointBySignatureId(item.endpointSignatureId)) {
        await audit({ actorId: device.subjectId, action: 'metadata.ingest', targetType: 'batch',
          targetId: parsed.data.batchId, outcome: 'rejected', correlationId: request.id,
          metadata: { reason: 'unregistered_endpoint_signature', eventId: item.eventId } });
        return reply.code(400).send({ error: 'unregistered_endpoint_signature', eventId: item.eventId });
      }
    }
    const observations: Observation[] = parsed.data.observations.map(item => ({
      ...(() => {
        const endpoint = item.endpointSignatureId ? endpointBySignatureId(item.endpointSignatureId) : null;
        return {
          endpointSignatureId: endpoint?.signatureId ?? null,
          endpointRole: endpoint?.role ?? null,
          endpointPurpose: endpoint?.purpose ?? null,
          endpointConfidence: endpoint?.confidence ?? null,
          endpointEvidenceSource: endpoint?.evidenceSource ?? null,
          endpointRegistryVersion: endpoint?.registryVersion ?? null,
        };
      })(),
      ...item,
      sourceAppName: item.sourceAppName ?? null,
      sourceAppCategory: normalizeAppCategory(item.sourceAppCategory),
      attributionMethod: item.attributionMethod ?? null,
      sourceUid: item.sourceUid ?? null,
      attributionFailureReason: item.attributionFailureReason ?? null,
      attributionSignals: item.attributionSignals,
      attributionLookupAttempts: item.attributionLookupAttempts,
      sharedUidPackageCount: item.sharedUidPackageCount ?? null,
      appSigningCertificateSha256: item.appSigningCertificateSha256 ?? null,
      appInstalledAt: item.appInstalledAt ?? null,
      appLastUpdatedAt: item.appLastUpdatedAt ?? null,
      isSystemApp: item.isSystemApp ?? null,
      appVersionName: item.appVersionName ?? null,
      appVersionCode: item.appVersionCode ?? null,
    }));
    await store.appendBatch({ batchId: parsed.data.batchId, deviceId: device.id,
      schemaVersion: parsed.data.schemaVersion, observations });
    await audit({ actorId: device.subjectId, action: 'metadata.ingest', targetType: 'batch',
      targetId: parsed.data.batchId, outcome: 'accepted', correlationId: request.id,
      metadata: { count: parsed.data.observations.length } });
    return reply.code(202).send({ batchId: parsed.data.batchId, accepted: parsed.data.observations.length });
  });

  app.post('/v1/collection-events', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = collectionEvent.safeParse(request.body);
    if (!parsed.success) {
      await audit({ actorId: device.subjectId, action: 'collector.lifecycle', targetType: 'collection_event', targetId: null,
        outcome: 'rejected', correlationId: request.id, metadata: { reason: 'invalid_event' } });
      return reply.code(400).send({ error: 'invalid_collection_event', issues: parsed.error.issues });
    }
    const futureLimit = Date.now() + 5 * 60 * 1000;
    if (Date.parse(parsed.data.occurredAt) > futureLimit
      || (parsed.data.lastHeartbeatAt && Date.parse(parsed.data.lastHeartbeatAt) > futureLimit)) {
      return reply.code(400).send({ error: 'collection_event_clock_ahead' });
    }
    if (await store.hasCollectionEvent(parsed.data.eventId)) return reply.code(409).send({ error: 'replay_detected' });
    await store.appendCollectionEvent({
      id: parsed.data.eventId, deviceId: device.id, sessionId: parsed.data.sessionId,
      eventType: parsed.data.eventType, occurredAt: parsed.data.occurredAt,
      reason: parsed.data.reason, lastHeartbeatAt: parsed.data.lastHeartbeatAt,
      appVersion: parsed.data.appVersion,
    });
    await audit({ actorId: device.subjectId, action: 'collector.lifecycle', targetType: 'collection_event',
      targetId: parsed.data.eventId, outcome: 'accepted', correlationId: request.id,
      metadata: { eventType: parsed.data.eventType, sessionId: parsed.data.sessionId } });
    return reply.code(202).send({ eventId: parsed.data.eventId, status: 'accepted' });
  });

  app.get('/v1/me/engine', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = engineQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const rawSnapshot = await store.engineSnapshot(device.id, device.subjectId, parsed.data.limit);
    const snapshot = governEngineSnapshot(rawSnapshot, {
      requestedMode: requestedEngineMode,
      manualProductionApproval,
      productionReadiness,
      compensationExecutionEnabled,
      anomalyTruePositiveRate,
    });
    await audit({ actorId: device.subjectId, action: 'engine.snapshot.read', targetType: 'device',
      targetId: device.id, outcome: 'allowed', correlationId: request.id,
      metadata: { returned: snapshot.observations.length, windowHours: snapshot.windowHours,
        policyVersion: snapshot.policy.version, selectedMode: snapshot.policy.selectedMode,
        compensationExecution: snapshot.policy.gates.compensationExecution,
        policyInputs: snapshot.policy.inputs,
        policyGates: snapshot.policy.gates,
        productionBlockers: snapshot.policy.blockers } });
    return snapshot;
  });

  app.get('/v1/me/consumer-state', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const state = await store.consumerState(device.id, device.subjectId);
    await audit({ actorId: device.subjectId, action: 'consumer.state.read', targetType: 'device', targetId: device.id,
      outcome: 'allowed', correlationId: request.id, metadata: {
        opportunities: state.opportunities.length,
        buyerMatchingEnabled: compensationExecutionEnabled,
      } });
    return compensationExecutionEnabled ? state : { ...state, opportunities: [] };
  });

  app.post('/v1/permissions/:id/revoke', async (request, reply) => {
    const device=await authenticate(request.headers.authorization);if(!device)return reply.code(401).send({error:'unauthorized'});const params=idParam.safeParse(request.params);const key=String(request.headers['idempotency-key']??'');if(!params.success||key.length<8||key.length>128)return reply.code(400).send({error:'invalid_request'});
    try{const result=await store.revokeCommercialPermission(device.id,device.subjectId,params.data.id,request.id,key);await audit({actorId:device.subjectId,action:'commercial_permission.revoke',targetType:'permission',targetId:params.data.id,outcome:'accepted',correlationId:request.id,metadata:{}});return reply.code(202).send(result);}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:'permission_revoke_failed'});}
  });
  app.post('/v1/opportunities/:id/accept', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const params = idParam.safeParse(request.params);
    const key = String(request.headers['idempotency-key'] ?? '');
    if (!params.success || key.length < 8 || key.length > 128) return reply.code(400).send({ error: 'invalid_request' });
    if (!compensationExecutionEnabled) {
      await audit({ actorId: device.subjectId, action: 'opportunity.accept', targetType: 'opportunity',
        targetId: params.data.id, outcome: 'denied', correlationId: request.id,
        metadata: { reason: 'compensation_execution_disabled', enginePolicyVersion: '1.0.0' } });
      return reply.code(403).send({ error: 'compensation_execution_disabled' });
    }
    try {
      const receipt = await store.acceptOpportunity(device.id, device.subjectId, params.data.id, request.id, key);
      await audit({ actorId: device.subjectId, action: 'opportunity.accept', targetType: 'opportunity',
        targetId: params.data.id, outcome: 'accepted', correlationId: request.id, metadata: { receiptId: receipt.id } });
      return reply.code(201).send(receipt);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'offer_accept_failed' });
    }
  });
  app.post('/v1/opportunities/:id/deliver', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    if (!compensationExecutionEnabled) {
      await audit({ actorId: device.subjectId, action: 'license.deliver', targetType: 'opportunity',
        targetId: params.data.id, outcome: 'denied', correlationId: request.id,
        metadata: { reason: 'compensation_execution_disabled', enginePolicyVersion: '1.0.0' } });
      return reply.code(403).send({ error: 'compensation_execution_disabled' });
    }
    try {
      const receipt = await store.deliverLicense(device.id, device.subjectId, params.data.id, request.id);
      await audit({ actorId: device.subjectId, action: 'license.deliver', targetType: 'opportunity',
        targetId: params.data.id, outcome: 'accepted', correlationId: request.id, metadata: { receiptId: receipt.id } });
      return receipt;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'delivery_failed' });
    }
  });
  app.get('/v1/receipts/:id',async(request,reply)=>{const device=await authenticate(request.headers.authorization);if(!device)return reply.code(401).send({error:'unauthorized'});const params=idParam.safeParse(request.params);if(!params.success)return reply.code(400).send({error:'invalid_request'});const receipt=await store.valueReceipt(device.subjectId,params.data.id);return receipt??reply.code(404).send({error:'not_found'});});
  app.post('/v1/feedback',async(request,reply)=>{const device=await authenticate(request.headers.authorization);if(!device)return reply.code(401).send({error:'unauthorized'});const parsed=feedbackInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'invalid_request'});const result=await store.appendFeedback({deviceId:device.id,subjectId:device.subjectId,...parsed.data,comment:parsed.data.comment??null,correlationId:request.id});await audit({actorId:device.subjectId,action:'feedback.append',targetType:parsed.data.targetType,targetId:parsed.data.targetId,outcome:'accepted',correlationId:request.id,metadata:{rating:parsed.data.rating}});return reply.code(202).send(result);});
  app.post('/v1/appeals',async(request,reply)=>{const device=await authenticate(request.headers.authorization);if(!device)return reply.code(401).send({error:'unauthorized'});const parsed=appealInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'invalid_request'});const result=await store.appendAppeal({deviceId:device.id,subjectId:device.subjectId,...parsed.data,correlationId:request.id});await audit({actorId:device.subjectId,action:'appeal.submit',targetType:parsed.data.targetType,targetId:parsed.data.targetId,outcome:'accepted',correlationId:request.id,metadata:{appealId:result.id}});return reply.code(201).send(result);});

  app.addHook('preHandler', async (request, reply) => {
    const protected026Prefixes = [
      '/v1/intelligence/',
      '/v1/inspector/',
      '/v1/marketplace/',
      '/v1/wallet/',
      '/v1/permissions/users/',
      '/core/compliance/v1/',
      '/core/blog-gateway/v1/',
    ];
    if (!protected026Prefixes.some(prefix => request.url.startsWith(prefix))) return;
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
  });
  const compliancePrimitive = z.union([z.string(), z.number(), z.boolean()]);
  const compliancePolicySchema = z.object({
    policy_id: z.string().min(1).max(120),
    version: z.string().min(1).max(64),
    status: z.enum(['active', 'inactive']),
    action: z.string().min(1).max(120),
    resource_type: z.string().min(1).max(120),
    required_consents: z.array(z.string().min(1).max(160)).max(100),
    required_attributes: z.record(compliancePrimitive).optional(),
    human_review: z.enum(['required', 'not_required']),
    conditions: z.array(z.string().min(1).max(240)).max(100).optional(),
    effective_from: z.string().datetime(),
    effective_to: z.string().datetime().nullable().optional(),
  }).strict();

  const complianceEvaluationSchema = z.object({
    action: z.string().min(1).max(120),
    resource_type: z.string().min(1).max(120),
    resource_id: z.string().min(1).max(240),
    consents: z.array(z.string().min(1).max(160)).max(100).optional(),
    attributes: z.record(compliancePrimitive).optional(),
  }).strict();

  app.post('/core/compliance/v1/evaluate', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = complianceEvaluationSchema.safeParse(request.body);
    if (!parsed.success) {
      await audit({
        actorId: device.subjectId,
        action: 'compliance.evaluate',
        targetType: 'compliance_request',
        targetId: null,
        outcome: 'rejected',
        correlationId: request.id,
        metadata: { reason: 'invalid_request' },
      });
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const decision = complianceEngine.evaluate({
      actor_id: device.subjectId,
      ...parsed.data,
    });

    await audit({
      actorId: device.subjectId,
      action: 'compliance.evaluate',
      targetType: decision.resource_type,
      targetId: decision.resource_id,
      outcome: decision.outcome === 'deny' ? 'denied' : 'allowed',
      correlationId: request.id,
      metadata: {
        decisionId: decision.decision_id,
        complianceOutcome: decision.outcome,
        policyId: decision.policy_id,
        policyVersion: decision.policy_version,
      },
    });

    return reply.code(200).send(decision);
  });

  app.get('/core/compliance/v1/decisions/:decision_id', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const decisionId = String((request.params as { decision_id?: string }).decision_id ?? '');
    if (!decisionId) return reply.code(400).send({ error: 'invalid_request' });

    const decision = complianceEngine.getDecision(decisionId);
    if (!decision || decision.actor_id !== device.subjectId) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return reply.code(200).send(decision);
  });

  app.get('/core/compliance/v1/policies', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.code(200).send({ policies: complianceEngine.listPolicies() });
  });

  app.put('/core/compliance/v1/policies/:policy_id/:version', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const params = request.params as { policy_id?: string; version?: string };
    const parsed = compliancePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    if (params.policy_id !== parsed.data.policy_id || params.version !== parsed.data.version) {
      return reply.code(409).send({ error: 'policy_identity_mismatch' });
    }

    const policy = complianceEngine.upsertPolicy(parsed.data as CompliancePolicy);
    await audit({
      actorId: device.subjectId,
      action: 'compliance.policy.upsert',
      targetType: 'compliance_policy',
      targetId: policy.policy_id,
      outcome: 'accepted',
      correlationId: request.id,
      metadata: { version: policy.version, status: policy.status },
    });

    return reply.code(200).send(policy);
  });
  const blogSubmissionSchema = z.object({
    resource_id: z.string().min(1).max(240),
    content_hash: z.string().min(16).max(256),
    consents: z.array(z.string().min(1).max(160)).max(100).optional(),
    attributes: z.record(compliancePrimitive).optional(),
  }).strict();

  const blogReviewSchema = z.object({
    approved: z.boolean(),
  }).strict();

  app.post('/core/blog-gateway/v1/submissions', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = blogSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const submission = blogComplianceGateway.createSubmission({
      actor_id: device.subjectId,
      ...parsed.data,
    });

    await audit({
      actorId: device.subjectId,
      action: 'blog_gateway.submission.create',
      targetType: 'blog_submission',
      targetId: submission.submission_id,
      outcome: 'accepted',
      correlationId: request.id,
      metadata: {
        resourceId: submission.resource_id,
        contentHash: submission.content_hash,
      },
    });

    return reply.code(201).send(submission);
  });

  app.get('/core/blog-gateway/v1/submissions/:submission_id', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const submissionId = String((request.params as { submission_id?: string }).submission_id ?? '');
    const submission = blogComplianceGateway.getSubmission(submissionId);

    if (!submission || submission.actor_id !== device.subjectId) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return reply.code(200).send(submission);
  });

  app.post('/core/blog-gateway/v1/submissions/:submission_id/review', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    if (!authenticateAdmin(String(request.headers['x-admin-secret'] ?? ''))) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const submissionId = String((request.params as { submission_id?: string }).submission_id ?? '');
    const parsed = blogReviewSchema.safeParse(request.body);
    if (!submissionId || !parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    try {
      const review = blogComplianceGateway.recordHumanReview(
        submissionId,
        device.subjectId,
        parsed.data.approved,
      );

      await audit({
        actorId: device.subjectId,
        action: 'blog_gateway.review.record',
        targetType: 'blog_submission',
        targetId: submissionId,
        outcome: parsed.data.approved ? 'accepted' : 'denied',
        correlationId: request.id,
        metadata: {
          reviewId: review.review_id,
          approved: review.approved,
        },
      });

      return reply.code(200).send(review);
    } catch (error) {
      return reply.code(404).send({
        error: error instanceof Error ? error.message : 'submission_not_found',
      });
    }
  });

  app.post('/core/blog-gateway/v1/submissions/:submission_id/authorize', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const submissionId = String((request.params as { submission_id?: string }).submission_id ?? '');
    const submission = blogComplianceGateway.getSubmission(submissionId);

    if (!submission || submission.actor_id !== device.subjectId) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const authorization = blogComplianceGateway.authorizePublish(submissionId);

    await audit({
      actorId: device.subjectId,
      action: 'blog_gateway.publish.authorize',
      targetType: 'blog_post',
      targetId: authorization.resource_id,
      outcome: authorization.permitted ? 'allowed' : 'denied',
      correlationId: request.id,
      metadata: {
        authorizationId: authorization.authorization_id,
        decisionId: authorization.decision_id,
        complianceOutcome: authorization.outcome,
      },
    });

    return reply.code(authorization.permitted ? 200 : 409).send(authorization);
  });

  app.get('/core/blog-gateway/v1/authorizations/:authorization_id', async (request, reply) => {
    const device = await authenticate(request.headers.authorization);
    if (!device) return reply.code(401).send({ error: 'unauthorized' });

    const authorizationId = String(
      (request.params as { authorization_id?: string }).authorization_id ?? '',
    );
    const authorization = blogComplianceGateway.getAuthorization(authorizationId);

    if (!authorization || authorization.actor_id !== device.subjectId) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return reply.code(200).send(authorization);
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

function normalizeAppCategory(value?: string | null): AppCategory | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const exact = new Set<AppCategory>(['social', 'finance', 'health', 'entertainment', 'utility', 'shopping', 'news', 'gaming', 'other']);
  if (exact.has(normalized as AppCategory)) return normalized as AppCategory;
  if (['games', 'game'].includes(normalized)) return 'gaming';
  if (['music and audio', 'video', 'photo and image'].includes(normalized)) return 'entertainment';
  if (['maps and navigation', 'productivity'].includes(normalized)) return 'utility';
  return 'other';
}

function normalizeEngineMode(value: string | undefined, environment: 'staging' | 'production'): EngineMode {
  if (value === 'development' || value === 'staging' || value === 'production') return value;
  return environment;
}

function resolveProductionReadiness(overrides?: Partial<ProductionReadiness>): ProductionReadiness {
  const environmentFlags: ProductionReadiness = {
    privacyReviewApproved: process.env.KICKS_PRIVACY_REVIEW_APPROVED === 'true',
    securityReviewApproved: process.env.KICKS_SECURITY_REVIEW_APPROVED === 'true',
    kycReady: process.env.KICKS_KYC_READY === 'true',
    settlementReady: process.env.KICKS_SETTLEMENT_READY === 'true',
    verifiedBuyerSpecs: process.env.KICKS_VERIFIED_BUYER_SPECS === 'true',
    productionSigningReady: process.env.KICKS_PRODUCTION_SIGNING_READY === 'true',
    auditRetentionReady: process.env.KICKS_AUDIT_RETENTION_READY === 'true',
  };
  return { ...environmentFlags, ...overrides };
}
