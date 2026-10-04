import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  attributionConfidence,
  combinedConfidence,
  enrichDomain,
  ownershipEvidenceWeight,
  type CommercialFunction,
} from './domain-intelligence.js';
import type { EndpointEvidenceSource, EndpointRole } from './endpoint-intelligence.js';
import {
  baselineGroupKey,
  buildBaselineAnalysis,
  buildWeeklyDigest,
  type BaselineContinuity,
  type BaselineDeviation,
  type BaselineInterruptionKind,
  type ObservationBaseline,
  type StabilitySummary,
  type WeeklyDigest,
} from './baseline.js';

export type Device = { id: string; subjectId: string; tokenHash: string; revoked: boolean; vaultId?: string | null };
export type AppCategory = 'social' | 'finance' | 'health' | 'entertainment' | 'utility' | 'shopping' | 'news' | 'gaming' | 'other';
export type ConsentEvent = {
  id: string; deviceId: string; subjectId: string; permissionId: string;
  vaultId?: string | null; activationId?: string | null; activationVaultId?: string | null; activationRequestId?: string | null;
  action: 'grant' | 'deny' | 'revoke'; purpose: string; policyVersion: string;
  purposeVersion: string; occurredAt: string; correlationId: string;
};
export type CollectionEventType = 'session_started' | 'heartbeat' | 'session_stopped' | 'vpn_revoked' | 'crash_detected';
export type CollectionEvent = {
  id: string; deviceId: string; sessionId: string; eventType: CollectionEventType;
  occurredAt: string; reason: string | null; lastHeartbeatAt: string | null; appVersion: string;
};
export type Observation = {
  eventId: string; occurredAt: string; sourceApp: string | null;
  sourceAppName: string | null; sourceAppCategory: AppCategory | null;
  attribution: 'verified' | 'best_effort' | 'unknown'; destinationHost: string;
  attributionMethod: 'android_connection_owner_uid' | null;
  sourceUid: number | null;
  attributionFailureReason: 'api_below_29' | 'connection_not_found' | 'package_not_visible' | 'shared_uid' | 'package_metadata_unavailable' | 'lookup_error' | null;
  attributionSignals: Array<'dns_query' | 'socket_owner_uid' | 'package_uid_mapping' | 'shared_uid_mapping' | 'package_metadata' | 'signing_certificate'>;
  attributionLookupAttempts: number; sharedUidPackageCount: number | null;
  appSigningCertificateSha256: string | null;
  endpointSignatureId: string | null; endpointRole: EndpointRole | null;
  endpointPurpose: string | null; endpointConfidence: number | null;
  endpointEvidenceSource: EndpointEvidenceSource | null; endpointRegistryVersion: string | null;
  appInstalledAt: string | null; appLastUpdatedAt: string | null; isSystemApp: boolean | null;
  appVersionName: string | null; appVersionCode: string | null;
  protocol: 'dns' | 'tcp' | 'udp' | 'tls' | 'quic' | 'other'; bytesBucket: string;
  classification: string; consentId: string; consentPurpose: string;
};
export type AuditEvent = {
  id: string; actorId: string | null; action: string; targetType: string;
  targetId: string | null; outcome: 'allowed' | 'denied' | 'accepted' | 'rejected';
  occurredAt: string; correlationId: string; metadata: Record<string, unknown>;
};
export type EngineObservation = {
  observationId: string; observedAt: string; appInstanceId: string | null;
  domainRegistryId: string | null; destinationDomain: string; requestFrequency: number;
  destinationHost: string; firstObservedAt: string; lastObservedAt: string; frequency: number;
  sourceApp: string | null; sourceAppName: string | null; sourceAppCategory: string | null;
  attribution: Observation['attribution']; protocol: Observation['protocol'];
  attributionMethod: Observation['attributionMethod']; bytesBucket: string;
  appInstalledAt: string | null; appLastUpdatedAt: string | null; isSystemApp: boolean | null;
  appVersionName: string | null; appVersionCode: string | null;
  classification: string; consentId: string; consentPurpose: string;
  consentStatus: 'active' | 'inactive' | 'missing';
  company: string; commercialFunction: CommercialFunction; domainSubcategory: string;
  corporateParentLegalName: string | null;
  corporateParentVerificationStatus: 'unverified' | 'corroborated' | 'verified' | 'disputed';
  ownershipConfidence: number; functionConfidence: number;
  domainClassificationSource: 'auto' | 'manual' | 'verified';
  domainReviewStatus: 'auto_classified' | 'manually_reviewed' | 'disputed';
  purpose: string; dataCategory: string;
  confidence: number; appConfidence: number; domainConfidence: number;
  evidence: string; typicality: string; registryVersion: string;
  endpointSignatureId: string | null; endpointRole: EndpointRole | null;
  endpointPurpose: string | null; endpointConfidence: number | null;
  endpointEvidenceSource: EndpointEvidenceSource | null; endpointRegistryVersion: string | null;
  plainLanguageSummary: string; behaviorSummary: string;
  isValueCandidate: boolean; reviewStatus: 'observed' | 'flagged' | 'reviewed' | 'dismissed';
  compensationEligible: boolean; eligibilityReason: string;
} & ObservationBaseline;
export type EngineSnapshot = {
  generatedAt: string; windowHours: 24;
  metrics: { observations: number; distinctDomains: number; review: number; attributedApps: number;
    attributedObservations: number; verifiedObservations: number; attributionCoveragePercent: number };
  consent: { permissionId: string | null; purpose: string | null; status: 'active' | 'inactive' | 'missing'; updatedAt: string | null };
  stability: StabilitySummary; deviations: BaselineDeviation[];
  weeklyDigest: WeeklyDigest;
  lastObservationAt: string | null; observations: EngineObservation[];
};
export type ConsumerState = {
  generatedAt: string;
  monitoringPermission: { permissionId: string; action: ConsentEvent['action']; purpose: string; occurredAt: string } | null;
  commercialPermissions: Array<{ grantId: string; action: 'grant'|'revoke'; dataCategory: string; purpose: string; expiresAt: string; occurredAt: string }>;
  opportunities: Array<{ id: string; buyerName: string; purpose: string; dataCategory: string; grossAmountCents: number; currency: string; confidence: number; status: string; expiresAt: string }>;
  wallet: { availableCents: number; pendingCents: number; currency: string; connected: boolean; transactions: Array<{ transactionId: string; receiptId: string | null; amountCents: number; currency: string; occurredAt: string; status: string }> };
};
export type ValueReceipt={id:string;transactionId:string;opportunityId:string;licenseId:string;grossCents:number;platformFeeCents:number;consumerProceedsCents:number;currency:string;buyerName:string;purpose:string;status:string;createdAt:string};
export type Appeal={id:string;targetType:string;targetId:string;reason:string;status:string;createdAt:string};
export type AdminControlCenterAggregate = {
  generatedAt: string;
  headline: { connections24h: number; domains24h: number; identifiedApps24h: number; reviewQueue24h: number };
  protocols: Array<{ name: Observation['protocol']; count: number }>;
  attribution: {
    attributedObservations: number; verifiedObservations: number; coveragePercent: number;
    endpointEvidencePercent: number | null;
    signals: Array<{ name: string; count: number }>;
    failures: Array<{ reason: string; count: number }>;
  };
  devices: Array<{
    id: string; platform: string; environment: string; appVersion: string | null;
    createdAt: string; revokedAt: string | null; lastSeenAt: string | null;
    observations24h: number; collectorState: StabilitySummary['collectorState'];
    verifiedHours: number; targetHours: 168; remainingHours: number;
    baselineConfidence: number; baselinePhase: StabilitySummary['phase'];
    resumeCount: number; lastInterruption: StabilitySummary['lastInterruption'];
  }>;
  registry: {
    totalDomains: number; classifiedDomains: number; disputedDomains: number; unknownDomains: number;
    mappings: Array<{ domain: string; company: string; function: string; confidence: number;
      source: string; lastUpdated: string; reviewStatus: string }>;
  };
  consentAudit: {
    observations: number; linkedObservations: number; linkagePercent: number;
    activeMonitoringGrants: number; activeCommercialGrants: number;
    events: Array<{ time: string; event: string; outcome: string; evidence: string }>;
  };
};

export interface Store {
  findDeviceByTokenHash(hash: string): Promise<Device | null>;
  createDevice(device: Device & { environment: 'staging' | 'production'; appVersion?: string }): Promise<void>;
  appendConsent(event: ConsentEvent): Promise<void>;
  currentConsent(deviceId: string, subjectId: string, permissionId: string): Promise<ConsentEvent | null>;
  consentByActivationRequest(deviceId: string, activationRequestId: string): Promise<ConsentEvent | null>;
  consentByActivationId(deviceId: string, activationId: string): Promise<ConsentEvent | null>;
  hasCollectionEvent(id: string): Promise<boolean>;
  appendCollectionEvent(event: CollectionEvent): Promise<void>;
  collectionEventsForDevice(deviceId: string): Promise<CollectionEvent[]>;
  hasBatch(id: string): Promise<boolean>;
  appendBatch(input: { batchId: string; deviceId: string; schemaVersion: string; observations: Observation[] }): Promise<void>;
  engineSnapshot(deviceId: string, subjectId: string, limit: number): Promise<EngineSnapshot>;
  consumerState(deviceId: string, subjectId: string): Promise<ConsumerState>;
  revokeCommercialPermission(deviceId:string,subjectId:string,grantId:string,correlationId:string,idempotencyKey:string):Promise<{id:string;status:'revoked'}>;
  acceptOpportunity(deviceId:string,subjectId:string,opportunityId:string,correlationId:string,idempotencyKey:string):Promise<ValueReceipt>;
  deliverLicense(deviceId:string,subjectId:string,opportunityId:string,correlationId:string):Promise<ValueReceipt>;
  valueReceipt(subjectId:string,receiptId:string):Promise<ValueReceipt|null>;
  appendFeedback(input:{deviceId:string;subjectId:string;targetType:string;targetId:string;rating:string;comment:string|null;correlationId:string}):Promise<{id:string;occurredAt:string}>;
  appendAppeal(input:{deviceId:string;subjectId:string;targetType:string;targetId:string;reason:string;correlationId:string}):Promise<Appeal>;
  adminControlCenterSnapshot(): Promise<AdminControlCenterAggregate>;
  appendAudit(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

type MemoryObservation = Observation & { deviceId: string; receivedAt: string };

export class MemoryStore implements Store {
  devices = new Map<string, Device>();
  consents: ConsentEvent[] = [];
  batches = new Set<string>();
  observations: Observation[] = [];
  observationRecords: MemoryObservation[] = [];
  collectionEvents: CollectionEvent[] = [];
  audits: AuditEvent[] = [];
  commercialRevocations:Array<{id:string;subjectId:string;grantId:string;idempotencyKey:string}>=[];
  opportunityRecords:Array<{id:string;subjectId:string;deviceId:string;buyerName:string;purpose:string;dataCategory:string;grossAmountCents:number;currency:string;confidence:number;status:string;expiresAt:string}>=[];
  receipts:ValueReceipt[]=[]; feedbackEvents:Array<Record<string,unknown>>=[]; appeals:Appeal[]=[];

  async findDeviceByTokenHash(hash: string) {
    return [...this.devices.values()].find(device => !device.revoked && safeEqual(device.tokenHash, hash)) ?? null;
  }
  async createDevice(device: Device) { this.devices.set(device.id, device); }
  async appendConsent(event: ConsentEvent) { this.consents.push(event); }
  async currentConsent(deviceId: string, subjectId: string, permissionId: string) {
    return [...this.consents].reverse().find(event => event.deviceId === deviceId && event.subjectId === subjectId && event.permissionId === permissionId) ?? null;
  }
  async consentByActivationRequest(deviceId: string, activationRequestId: string) {
    return [...this.consents].reverse().find(event =>
      event.deviceId === deviceId && event.activationRequestId === activationRequestId
    ) ?? null;
  }
  async consentByActivationId(deviceId: string, activationId: string) {
    return [...this.consents].reverse().find(event =>
      event.deviceId === deviceId && event.activationId === activationId
    ) ?? null;
  }
  async hasCollectionEvent(id: string) { return this.collectionEvents.some(event => event.id === id); }
  async appendCollectionEvent(event: CollectionEvent) { this.collectionEvents.push(event); }
  async collectionEventsForDevice(deviceId: string) {
    return this.collectionEvents.filter(event => event.deviceId === deviceId);
  }
  async hasBatch(id: string) { return this.batches.has(id); }
  async appendBatch(input: { batchId: string; deviceId: string; observations: Observation[] }) {
    this.batches.add(input.batchId);
    this.observations.push(...input.observations);
    const receivedAt = new Date().toISOString();
    this.observationRecords.push(...input.observations.map(observation => ({ ...observation, deviceId: input.deviceId, receivedAt })));
  }
  async engineSnapshot(deviceId: string, subjectId: string, limit: number): Promise<EngineSnapshot> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const historyCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const historyRecords = this.observationRecords.filter(record =>
      record.deviceId === deviceId && Date.parse(record.occurredAt) >= historyCutoff && isVisibleDestination(record.destinationHost));
    const continuity = collectionContinuity(await this.collectionEventsForDevice(deviceId), historyRecords);
    const baseline = buildBaselineAnalysis(historyRecords, new Date(), continuity);
    const weeklyDigest = buildWeeklyDigest(historyRecords, baseline, { matches: 0, estimatedValueCents: null });
    const records = this.observationRecords.filter(record =>
      record.deviceId === deviceId && Date.parse(record.occurredAt) >= cutoff && isVisibleDestination(record.destinationHost));
    const grouped = new Map<string, MemoryObservation[]>();
    for (const record of records) {
      const key = groupKey(record.sourceApp, record.destinationHost);
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }
    const functionCounts = buildFunctionCounts(records);
    const observations = await Promise.all([...grouped.values()].map(async values => {
      values.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
      const latest = values[0]!;
      const consent = await this.consentByActivationId(deviceId, latest.consentId);
      const input = {
        deviceId, eventId: latest.eventId,
        destinationHost: latest.destinationHost, firstObservedAt: values.at(-1)!.occurredAt, lastObservedAt: latest.occurredAt,
        frequency: values.length, sourceApp: latest.sourceApp, attribution: latest.attribution,
        sourceAppName: latest.sourceAppName, sourceAppCategory: latest.sourceAppCategory,
        attributionMethod: latest.attributionMethod, bytesBucket: latest.bytesBucket,
        endpointSignatureId: latest.endpointSignatureId, endpointRole: latest.endpointRole,
        endpointPurpose: latest.endpointPurpose, endpointConfidence: latest.endpointConfidence,
        endpointEvidenceSource: latest.endpointEvidenceSource, endpointRegistryVersion: latest.endpointRegistryVersion,
        appInstalledAt: latest.appInstalledAt, appLastUpdatedAt: latest.appLastUpdatedAt,
        isSystemApp: latest.isSystemApp, appVersionName: latest.appVersionName, appVersionCode: latest.appVersionCode,
        protocol: latest.protocol, classification: latest.classification, consentId: latest.consentId,
        consentPurpose: latest.consentPurpose, consentStatus: consentStatus(consent?.action),
      };
      return presentObservation(input, functionCounts,
        baseline.byGroup.get(baselineGroupKey(input.sourceApp, input.destinationHost)));
    }));
    observations.sort((left, right) => Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt));
    const latestConsent = [...this.consents]
      .filter(event => event.subjectId === subjectId && event.deviceId === deviceId)
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))[0];
    return {
      generatedAt: new Date().toISOString(), windowHours: 24,
      metrics: {
        observations: records.length, distinctDomains: new Set(records.map(record => record.destinationHost)).size,
        review: observations.filter(observation => ['unexpected', 'unknown'].includes(observation.behaviorTier)).length,
        attributedApps: new Set(records.map(record => record.sourceApp).filter(Boolean)).size,
        attributedObservations: records.filter(record => record.sourceApp !== null).length,
        verifiedObservations: records.filter(record => record.attribution === 'verified').length,
        attributionCoveragePercent: records.length === 0 ? 0
          : Math.round(records.filter(record => record.sourceApp !== null).length * 100 / records.length),
      },
      consent: {
        permissionId: latestConsent?.permissionId ?? null, purpose: latestConsent?.purpose ?? null,
        status: consentStatus(latestConsent?.action), updatedAt: latestConsent?.occurredAt ?? null,
      },
      stability: baseline.stability,
      deviations: baseline.deviations,
      weeklyDigest,
      lastObservationAt: observations[0]?.lastObservedAt ?? null,
      observations: observations.slice(0, limit),
    };
  }
  async appendAudit(event: AuditEvent) { this.audits.push(event); }
  async consumerState(deviceId: string, subjectId: string): Promise<ConsumerState> {
    const monitoring = [...this.consents].filter(event => event.deviceId === deviceId && event.subjectId === subjectId)
      .sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
    const subjectReceipts=this.receipts.filter(item=>this.opportunityRecords.some(o=>o.id===item.opportunityId&&o.subjectId===subjectId));
    return { generatedAt: new Date().toISOString(), monitoringPermission: monitoring ? { permissionId: monitoring.permissionId, action: monitoring.action, purpose: monitoring.purpose, occurredAt: monitoring.occurredAt } : null, commercialPermissions: [], opportunities: this.opportunityRecords.filter(o=>o.deviceId===deviceId&&o.subjectId===subjectId&&['consented','matched'].includes(o.status)), wallet: { availableCents: subjectReceipts.filter(r=>r.status==='settled').reduce((n,r)=>n+r.consumerProceedsCents,0), pendingCents: subjectReceipts.filter(r=>r.status!=='settled').reduce((n,r)=>n+r.consumerProceedsCents,0), currency: 'USD', connected: subjectReceipts.length>0, transactions: subjectReceipts.map(r=>({transactionId:r.transactionId,receiptId:r.id,amountCents:r.consumerProceedsCents,currency:r.currency,occurredAt:r.createdAt,status:r.status})) } };
  }
  async revokeCommercialPermission(_d:string,subjectId:string,grantId:string,_c:string,idempotencyKey:string){const prior=this.commercialRevocations.find(x=>x.subjectId===subjectId&&x.idempotencyKey===idempotencyKey);if(prior)return{id:prior.id,status:'revoked' as const};const item={id:randomUUID(),subjectId,grantId,idempotencyKey};this.commercialRevocations.push(item);return{id:item.id,status:'revoked' as const};}
  async acceptOpportunity(deviceId:string,subjectId:string,opportunityId:string,_c:string,idempotencyKey:string){const prior=this.receipts.find(r=>r.transactionId===idempotencyKey);if(prior)return prior;const offer=this.opportunityRecords.find(o=>o.id===opportunityId&&o.deviceId===deviceId&&o.subjectId===subjectId);if(!offer||!['matched','consented'].includes(offer.status)||Date.parse(offer.expiresAt)<=Date.now())throw new Error('OFFER_NOT_AVAILABLE');offer.status='accepted';const fee=Math.floor(offer.grossAmountCents*.1);const receipt:ValueReceipt={id:randomUUID(),transactionId:idempotencyKey,opportunityId,licenseId:randomUUID(),grossCents:offer.grossAmountCents,platformFeeCents:fee,consumerProceedsCents:offer.grossAmountCents-fee,currency:offer.currency,buyerName:offer.buyerName,purpose:offer.purpose,status:'accepted',createdAt:new Date().toISOString()};this.receipts.push(receipt);return receipt;}
  async deliverLicense(_d:string,subjectId:string,opportunityId:string,_c:string){const receipt=this.receipts.find(r=>r.opportunityId===opportunityId&&this.opportunityRecords.some(o=>o.id===opportunityId&&o.subjectId===subjectId));if(!receipt)throw new Error('ACCEPTED_OFFER_REQUIRED');receipt.status='settled';const offer=this.opportunityRecords.find(o=>o.id===opportunityId);if(offer)offer.status='paid';return receipt;}
  async valueReceipt(subjectId:string,receiptId:string){return this.receipts.find(r=>r.id===receiptId&&this.opportunityRecords.some(o=>o.id===r.opportunityId&&o.subjectId===subjectId))??null;}
  async appendFeedback(input:{deviceId:string;subjectId:string;targetType:string;targetId:string;rating:string;comment:string|null;correlationId:string}){const item={id:randomUUID(),occurredAt:new Date().toISOString(),...input};this.feedbackEvents.push(item);return{id:item.id,occurredAt:item.occurredAt};}
  async appendAppeal(input:{deviceId:string;subjectId:string;targetType:string;targetId:string;reason:string;correlationId:string}){const item:Appeal={id:randomUUID(),targetType:input.targetType,targetId:input.targetId,reason:input.reason,status:'submitted',createdAt:new Date().toISOString()};this.appeals.push(item);return item;}
  async adminControlCenterSnapshot(): Promise<AdminControlCenterAggregate> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const records = this.observationRecords.filter(record => Date.parse(record.occurredAt) >= cutoff
      && isVisibleDestination(record.destinationHost));
    const protocols = [...new Set(records.map(record => record.protocol))].map(name => ({
      name, count: records.filter(record => record.protocol === name).length,
    }));
    const attributed = records.filter(record => record.sourceApp !== null).length;
    const verified = records.filter(record => record.attribution === 'verified').length;
    const endpointCount = records.filter(record => record.endpointSignatureId !== null).length;
    const signalNames = [...new Set(records.flatMap(record => record.attributionSignals))];
    const failureNames = [...new Set(records.map(record => record.attributionFailureReason).filter(Boolean))] as string[];
    const devices = await Promise.all([...this.devices.values()].map(async device => {
      const subjectRecords = records.filter(record => record.deviceId === device.id);
      const snapshot = await this.engineSnapshot(device.id, device.subjectId, 1);
      return {
        id: device.id, platform: 'android', environment: 'staging', appVersion: null,
        createdAt: new Date().toISOString(), revokedAt: device.revoked ? new Date().toISOString() : null,
        lastSeenAt: snapshot.lastObservationAt, observations24h: subjectRecords.length,
        collectorState: snapshot.stability.collectorState, verifiedHours: snapshot.stability.verifiedHours,
        targetHours: 168 as const, remainingHours: snapshot.stability.remainingHours,
        baselineConfidence: snapshot.stability.confidence, baselinePhase: snapshot.stability.phase,
        resumeCount: snapshot.stability.resumeCount, lastInterruption: snapshot.stability.lastInterruption,
      };
    }));
    const linked = records.filter(record => this.consents.some(event => event.deviceId === record.deviceId
      && event.activationId === record.consentId && event.action === 'grant' && event.purpose === record.consentPurpose)).length;
    return {
      generatedAt: new Date().toISOString(),
      headline: { connections24h: records.length, domains24h: new Set(records.map(record => record.destinationHost)).size,
        identifiedApps24h: new Set(records.flatMap(record => record.sourceApp ? [record.sourceApp] : [])).size,
        reviewQueue24h: records.filter(record => ['review', 'unpermissioned', 'unknown'].includes(record.classification)).length },
      protocols,
      attribution: { attributedObservations: attributed, verifiedObservations: verified,
        coveragePercent: records.length ? Math.round(attributed * 1000 / records.length) / 10 : 0,
        endpointEvidencePercent: records.length ? Math.round(endpointCount * 1000 / records.length) / 10 : null,
        signals: signalNames.map(name => ({ name, count: records.filter(record => record.attributionSignals.includes(name as Observation['attributionSignals'][number])).length })),
        failures: failureNames.map(reason => ({ reason, count: records.filter(record => record.attributionFailureReason === reason).length })) },
      devices,
      registry: { totalDomains: new Set(records.map(record => record.destinationHost)).size, classifiedDomains: 0,
        disputedDomains: 0, unknownDomains: new Set(records.map(record => record.destinationHost)).size, mappings: [] },
      consentAudit: { observations: records.length, linkedObservations: linked,
        linkagePercent: records.length ? Math.round(linked * 1000 / records.length) / 10 : 100,
        activeMonitoringGrants: this.consents.filter(event => event.action === 'grant').length,
        activeCommercialGrants: 0,
        events: this.audits.slice(-20).reverse().map(event => ({ time: event.occurredAt, event: event.action,
          outcome: event.outcome, evidence: event.targetType })) },
    };
  }
  async close() {}
}

export class PostgresStore implements Store {
  private continuitySchemaReady: Promise<void> | null = null;
  constructor(private pool: Pool) {}
  static fromConnectionString(connectionString: string) {
    const url = new URL(connectionString);
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

    if (isLoopback) {
      // The DataStorm Windows staging service talks to PostgreSQL over loopback.
      // pg interprets sslmode=require from a connection URL even when the local
      // PostgreSQL listener has TLS disabled, so remove all TLS URL parameters
      // and explicitly disable TLS for this machine-local hop.
      ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].forEach(parameter => {
        url.searchParams.delete(parameter);
      });
      return new PostgresStore(new Pool({ connectionString: url.toString(), ssl: false, max: 10 }));
    }

    return new PostgresStore(new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
      max: 10,
    }));
  }
  async findDeviceByTokenHash(hash: string) {
    const row = (await this.pool.query('SELECT id,subject_id,token_hash,revoked_at,vault_id FROM devices WHERE token_hash=$1', [hash])).rows[0];
    return row && !row.revoked_at ? { id: row.id, subjectId: row.subject_id, tokenHash: row.token_hash, revoked: false, vaultId: row.vault_id ?? null } : null;
  }
  async createDevice(device: Device & { environment: 'staging' | 'production'; appVersion?: string }) {
    await this.pool.query('INSERT INTO devices(id,subject_id,token_hash,environment,app_version,vault_id) VALUES($1,$2,$3,$4,$5,$6)',
      [device.id, device.subjectId, device.tokenHash, device.environment, device.appVersion ?? null, device.vaultId ?? null]);
  }
  async appendConsent(event: ConsentEvent) {
    await this.pool.query('INSERT INTO consent_events(id,device_id,subject_id,permission_id,action,purpose,policy_version,purpose_version,occurred_at,correlation_id,vault_id,activation_id,activation_vault_id,activation_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [event.id, event.deviceId, event.subjectId, event.permissionId, event.action, event.purpose, event.policyVersion, event.purposeVersion, event.occurredAt, event.correlationId, event.vaultId ?? null, event.activationId ?? null, event.activationVaultId ?? null, event.activationRequestId ?? null]);
  }
  async currentConsent(deviceId: string, subjectId: string, permissionId: string) {
    const row = (await this.pool.query('SELECT * FROM consent_events WHERE device_id=$1 AND subject_id=$2 AND permission_id=$3 ORDER BY occurred_at DESC LIMIT 1', [deviceId, subjectId, permissionId])).rows[0];
    return row ? mapConsent(row) : null;
  }
  async consentByActivationRequest(deviceId: string, activationRequestId: string) {
    const row = (await this.pool.query(
      'SELECT * FROM consent_events WHERE device_id=$1 AND activation_request_id=$2 ORDER BY occurred_at DESC LIMIT 1',
      [deviceId, activationRequestId]
    )).rows[0];
    return row ? mapConsent(row) : null;
  }

  async consentByActivationId(deviceId: string, activationId: string) {
    const row = (await this.pool.query(
      'SELECT * FROM consent_events WHERE device_id=$1 AND activation_id=$2 ORDER BY occurred_at DESC LIMIT 1',
      [deviceId, activationId]
    )).rows[0];
    return row ? mapConsent(row) : null;
  }
  async hasCollectionEvent(id: string) {
    await this.ensureContinuitySchema();
    return (await this.pool.query('SELECT 1 FROM collection_events WHERE id=$1', [id])).rowCount === 1;
  }
  async appendCollectionEvent(event: CollectionEvent) {
    await this.ensureContinuitySchema();
    await this.pool.query(`INSERT INTO collection_events(
      id,device_id,session_id,event_type,occurred_at,reason,last_heartbeat_at,app_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [event.id, event.deviceId, event.sessionId, event.eventType, event.occurredAt,
      event.reason, event.lastHeartbeatAt, event.appVersion]);
  }
  async collectionEventsForDevice(deviceId: string) {
    await this.ensureContinuitySchema();
    const result = await this.pool.query(`SELECT id,device_id,session_id,event_type,occurred_at,reason,last_heartbeat_at,app_version
      FROM collection_events WHERE device_id=$1 ORDER BY occurred_at,received_at,id`, [deviceId]);
    return result.rows.map(row => ({
      id: row.id, deviceId: row.device_id, sessionId: row.session_id, eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(), reason: row.reason,
      lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null, appVersion: row.app_version,
    }));
  }
  async hasBatch(id: string) { return (await this.pool.query('SELECT 1 FROM metadata_batches WHERE id=$1', [id])).rowCount === 1; }
  async appendBatch(input: { batchId: string; deviceId: string; schemaVersion: string; observations: Observation[] }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO metadata_batches(id,device_id,schema_version,observation_count) VALUES($1,$2,$3,$4)',
        [input.batchId, input.deviceId, input.schemaVersion, input.observations.length]);
      for (const observation of input.observations) await insertObservation(client, input.batchId, input.deviceId, observation);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }
  async consumerState(deviceId: string, subjectId: string): Promise<ConsumerState> {
    const monitoring = (await this.pool.query(`SELECT permission_id,action,purpose,occurred_at FROM consent_events WHERE device_id=$1 AND subject_id=$2 ORDER BY occurred_at DESC LIMIT 1`, [deviceId,subjectId])).rows[0];
    const grants = (await this.pool.query(`SELECT DISTINCT ON (grant_id) grant_id,action,data_category,commercial_function,expires_at,occurred_at FROM commercial_consent_events WHERE device_id=$1 AND subject_id=$2 ORDER BY grant_id,occurred_at DESC`, [deviceId,subjectId])).rows;
    const opportunities = (await this.pool.query(`SELECT m.id,b.buyer_name,b.purpose,m.data_category,m.estimated_value_cents,m.currency,m.match_confidence,m.status,m.expires_at FROM opportunity_matches m JOIN buyer_specs b ON b.id=m.buyer_spec_id WHERE m.device_id=$1 AND m.subject_id=$2 AND m.status IN ('consented','matched') AND m.expires_at>now() ORDER BY m.created_at DESC`, [deviceId,subjectId])).rows;
    const ledger = (await this.pool.query(`SELECT l.transaction_id,l.direction,l.amount_cents,l.currency,l.occurred_at,r.id receipt_id,COALESCE(r.status,'recorded') status FROM ledger_entries l LEFT JOIN value_receipts r ON r.transaction_id=l.transaction_id AND r.subject_id=$1 WHERE l.account_id=$1 ORDER BY l.occurred_at DESC LIMIT 100`, [subjectId])).rows;
    const net = ledger.reduce((sum,row)=>sum+(row.direction==='credit'?Number(row.amount_cents):-Number(row.amount_cents)),0);
    return { generatedAt:new Date().toISOString(), monitoringPermission:monitoring?{permissionId:monitoring.permission_id,action:monitoring.action,purpose:monitoring.purpose,occurredAt:monitoring.occurred_at.toISOString()}:null,
      commercialPermissions:grants.map(row=>({grantId:row.grant_id,action:row.action,dataCategory:row.data_category,purpose:row.commercial_function,expiresAt:row.expires_at.toISOString(),occurredAt:row.occurred_at.toISOString()})),
      opportunities:opportunities.map(row=>({id:row.id,buyerName:row.buyer_name,purpose:row.purpose,dataCategory:row.data_category,grossAmountCents:row.estimated_value_cents,currency:row.currency,confidence:row.match_confidence,status:row.status,expiresAt:row.expires_at.toISOString()})),
      wallet:{availableCents:Math.max(0,net),pendingCents:0,currency:ledger[0]?.currency??'USD',connected:ledger.length>0,transactions:ledger.map(row=>({transactionId:row.transaction_id,receiptId:row.receipt_id??null,amountCents:Number(row.amount_cents)*(row.direction==='credit'?1:-1),currency:row.currency,occurredAt:row.occurred_at.toISOString(),status:row.status}))} };
  }
  async revokeCommercialPermission(deviceId:string,subjectId:string,grantId:string,correlationId:string,idempotencyKey:string){
    const client=await this.pool.connect();try{await client.query('BEGIN');const prior=(await client.query(`SELECT id FROM consumer_decisions WHERE subject_id=$1 AND idempotency_key=$2`,[subjectId,idempotencyKey])).rows[0];if(prior){await client.query('COMMIT');return{id:prior.id,status:'revoked' as const};}
      const grant=(await client.query(`SELECT * FROM commercial_consent_events WHERE subject_id=$1 AND device_id=$2 AND grant_id=$3 ORDER BY occurred_at DESC LIMIT 1 FOR UPDATE`,[subjectId,deviceId,grantId])).rows[0];if(!grant||grant.action!=='grant')throw new Error('ACTIVE_PERMISSION_REQUIRED');const now=new Date().toISOString(),id=randomUUID();await client.query(`INSERT INTO consumer_decisions(id,subject_id,device_id,decision_type,target_id,decision_version,occurred_at,correlation_id,idempotency_key) VALUES($1,$2,$3,'permission_revoke',$4,'decision-v1',$5,$6,$7)`,[id,subjectId,deviceId,grantId,now,correlationId,idempotencyKey]);await client.query(`INSERT INTO commercial_consent_events(id,grant_id,subject_id,device_id,action,data_category,commercial_function,occurred_at,expires_at,consent_version,source_observation_ids,correlation_id) VALUES($1,$2,$3,$4,'revoke',$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),grantId,subjectId,deviceId,grant.data_category,grant.commercial_function,now,grant.expires_at,grant.consent_version,grant.source_observation_ids,correlationId]);await client.query(`UPDATE data_licenses SET status='revoked',revoked_at=$1 WHERE subject_id=$2 AND opportunity_id IN(SELECT id FROM opportunity_matches WHERE consent_grant_id=$3) AND status='issued'`,[now,subjectId,grantId]);await client.query('COMMIT');return{id,status:'revoked' as const};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async acceptOpportunity(deviceId:string,subjectId:string,opportunityId:string,correlationId:string,idempotencyKey:string):Promise<ValueReceipt>{
    const client=await this.pool.connect();try{await client.query('BEGIN');const existing=(await client.query(`SELECT r.* FROM consumer_decisions d JOIN value_receipts r ON r.opportunity_id=d.target_id WHERE d.subject_id=$1 AND d.idempotency_key=$2`,[subjectId,idempotencyKey])).rows[0];if(existing){await client.query('COMMIT');return mapReceipt(existing);}
      const offer=(await client.query(`SELECT m.*,b.buyer_name,b.purpose,b.retention_days,b.id buyer_id FROM opportunity_matches m JOIN buyer_specs b ON b.id=m.buyer_spec_id WHERE m.id=$1 AND m.subject_id=$2 AND m.device_id=$3 FOR UPDATE`,[opportunityId,subjectId,deviceId])).rows[0];if(!offer||!['matched','consented'].includes(offer.status)||new Date(offer.expires_at)<=new Date())throw new Error('OFFER_NOT_AVAILABLE');const grant=(await client.query(`SELECT action,expires_at FROM commercial_consent_events WHERE subject_id=$1 AND grant_id=$2 ORDER BY occurred_at DESC LIMIT 1`,[subjectId,offer.consent_grant_id])).rows[0];if(!grant||grant.action!=='grant'||new Date(grant.expires_at)<=new Date())throw new Error('ACTIVE_PERMISSION_REQUIRED');
      const now=new Date().toISOString(),decisionId=randomUUID(),licenseId=randomUUID(),receiptId=randomUUID(),transactionId=randomUUID(),gross=Number(offer.estimated_value_cents),fee=Math.floor(gross*.1),proceeds=gross-fee;await client.query(`INSERT INTO consumer_decisions(id,subject_id,device_id,decision_type,target_id,decision_version,occurred_at,correlation_id,idempotency_key) VALUES($1,$2,$3,'offer_accept',$4,'decision-v1',$5,$6,$7)`,[decisionId,subjectId,deviceId,opportunityId,now,correlationId,idempotencyKey]);await client.query(`INSERT INTO data_licenses(id,subject_id,opportunity_id,buyer_spec_id,purpose,data_category,retention_days,status,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,'issued',$8)`,[licenseId,subjectId,opportunityId,offer.buyer_spec_id,offer.purpose,offer.data_category,offer.retention_days,now]);await client.query(`INSERT INTO value_receipts(id,transaction_id,subject_id,opportunity_id,license_id,gross_amount_cents,platform_fee_cents,consumer_proceeds_cents,currency,buyer_name,purpose,status,created_at,settled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'accepted',$12,NULL)`,[receiptId,transactionId,subjectId,opportunityId,licenseId,gross,fee,proceeds,offer.currency,offer.buyer_name,offer.purpose,now]);await client.query(`INSERT INTO ledger_entries(id,transaction_id,account_id,direction,amount_cents,currency,external_reference) VALUES($1,$2,$3,'debit',$4,$5,$6),($7,$2,$8,'credit',$9,$5,$6),($10,$2,$11,'credit',$12,$5,$6)`,[randomUUID(),transactionId,offer.buyer_id,gross,offer.currency,receiptId,randomUUID(),subjectId,proceeds,randomUUID(),'00000000-0000-4000-8000-000000000001',fee]);await client.query(`UPDATE opportunity_matches SET status='accepted' WHERE id=$1`,[opportunityId]);await client.query('COMMIT');return{id:receiptId,transactionId,opportunityId,licenseId,grossCents:gross,platformFeeCents:fee,consumerProceedsCents:proceeds,currency:offer.currency,buyerName:offer.buyer_name,purpose:offer.purpose,status:'accepted',createdAt:now};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async deliverLicense(deviceId:string,subjectId:string,opportunityId:string,_correlationId:string):Promise<ValueReceipt>{const client=await this.pool.connect();try{await client.query('BEGIN');const row=(await client.query(`SELECT r.* FROM value_receipts r JOIN opportunity_matches o ON o.id=r.opportunity_id WHERE r.opportunity_id=$1 AND r.subject_id=$2 AND o.device_id=$3 FOR UPDATE`,[opportunityId,subjectId,deviceId])).rows[0];if(!row)throw new Error('ACCEPTED_OFFER_REQUIRED');const now=new Date().toISOString();await client.query(`UPDATE data_licenses SET status='delivered',delivered_at=$1 WHERE id=$2 AND status='issued'`,[now,row.license_id]);await client.query(`UPDATE value_receipts SET status='settled',settled_at=$1 WHERE id=$2`,[now,row.id]);await client.query(`UPDATE opportunity_matches SET status='paid',paid_at=$1 WHERE id=$2`,[now,opportunityId]);await client.query('COMMIT');return{...mapReceipt(row),status:'settled'};}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  async valueReceipt(subjectId:string,receiptId:string){const row=(await this.pool.query(`SELECT * FROM value_receipts WHERE id=$1 AND subject_id=$2`,[receiptId,subjectId])).rows[0];return row?mapReceipt(row):null;}
  async appendFeedback(input:{deviceId:string;subjectId:string;targetType:string;targetId:string;rating:string;comment:string|null;correlationId:string}){const id=randomUUID(),occurredAt=new Date().toISOString();await this.pool.query(`INSERT INTO feedback_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,input.subjectId,input.deviceId,input.targetType,input.targetId,input.rating,input.comment,occurredAt,input.correlationId]);return{id,occurredAt};}
  async appendAppeal(input:{deviceId:string;subjectId:string;targetType:string;targetId:string;reason:string;correlationId:string}){const id=randomUUID(),createdAt=new Date().toISOString();await this.pool.query(`INSERT INTO appeals VALUES($1,$2,$3,$4,$5,$6,'submitted',$7,$7,$8)`,[id,input.subjectId,input.deviceId,input.targetType,input.targetId,input.reason,createdAt,input.correlationId]);return{id,targetType:input.targetType,targetId:input.targetId,reason:input.reason,status:'submitted',createdAt};}
  async engineSnapshot(deviceId: string, subjectId: string, limit: number): Promise<EngineSnapshot> {
    const visibilityFilter = `b.device_id = $1
      AND o.destination_host <> 'staging-api.datastorminc.live'
      AND o.destination_host !~ '\\.(in-addr|ip6)\\.arpa$'`;
    const filter = `${visibilityFilter} AND o.occurred_at >= now() - interval '24 hours'`;
    const metricsResult = await this.pool.query(`SELECT count(*)::int AS observations,
      count(DISTINCT o.destination_host)::int AS distinct_domains,
      count(*) FILTER (WHERE o.classification IN ('review','unpermissioned'))::int AS review,
      count(DISTINCT o.source_app) FILTER (WHERE o.source_app IS NOT NULL)::int AS attributed_apps,
      count(*) FILTER (WHERE o.source_app IS NOT NULL)::int AS attributed_observations,
      count(*) FILTER (WHERE o.attribution='verified')::int AS verified_observations,
      max(o.occurred_at) AS last_observation_at
      FROM metadata_batches b JOIN metadata_observations o ON o.batch_id=b.id WHERE ${filter}`, [deviceId]);
    const observationsResult = await this.pool.query(`WITH base AS (
        SELECT o.* FROM metadata_batches b JOIN metadata_observations o ON o.batch_id=b.id WHERE ${filter}),
      grouped AS (SELECT source_app,destination_host,min(occurred_at) AS first_observed_at,
        max(occurred_at) AS last_observed_at,count(*)::int AS frequency FROM base GROUP BY source_app,destination_host),
      latest AS (SELECT DISTINCT ON (source_app,destination_host) * FROM base
        ORDER BY source_app,destination_host,occurred_at DESC)
      SELECT grouped.*,latest.source_app_name,latest.source_app_category,latest.attribution,latest.protocol,latest.classification,
        latest.id AS latest_observation_id,latest.bytes_bucket,latest.attribution_method,
        latest.endpoint_signature_id,latest.endpoint_role,latest.endpoint_purpose,latest.endpoint_confidence,
        latest.endpoint_evidence_source,latest.endpoint_registry_version,
        latest.app_installed_at,latest.app_last_updated_at,latest.is_system_app,latest.app_version_name,latest.app_version_code,
        latest.consent_id,latest.consent_purpose,consent.action AS consent_action
      FROM grouped JOIN latest ON latest.destination_host=grouped.destination_host
        AND latest.source_app IS NOT DISTINCT FROM grouped.source_app
      LEFT JOIN LATERAL (SELECT action FROM consent_events WHERE subject_id=$2 AND device_id=$1
        AND activation_id=latest.consent_id ORDER BY occurred_at DESC LIMIT 1) consent ON true
      ORDER BY grouped.last_observed_at DESC LIMIT $3`, [deviceId, subjectId, limit]);
    const historyResult = await this.pool.query(`SELECT o.occurred_at,o.source_app,o.source_app_name,o.destination_host
      FROM metadata_batches b JOIN metadata_observations o ON o.batch_id=b.id
      WHERE ${visibilityFilter} AND o.occurred_at >= now() - interval '30 days'
      ORDER BY o.occurred_at`, [deviceId]);
    const consentResult = await this.pool.query(`SELECT permission_id,purpose,action,occurred_at FROM consent_events
      WHERE subject_id=$1 AND device_id=$2 ORDER BY occurred_at DESC LIMIT 1`, [subjectId, deviceId]);
    const metrics = metricsResult.rows[0];
    const latestConsent = consentResult.rows[0];
    const rawObservations = observationsResult.rows.map(row => ({
      deviceId, eventId: row.latest_observation_id,
      destinationHost: row.destination_host, firstObservedAt: row.first_observed_at.toISOString(),
      lastObservedAt: row.last_observed_at.toISOString(), frequency: row.frequency,
      sourceApp: row.source_app, sourceAppName: row.source_app_name, sourceAppCategory: row.source_app_category,
      attribution: row.attribution, protocol: row.protocol, classification: row.classification,
      attributionMethod: row.attribution_method, bytesBucket: row.bytes_bucket,
      endpointSignatureId: row.endpoint_signature_id, endpointRole: row.endpoint_role,
      endpointPurpose: row.endpoint_purpose, endpointConfidence: row.endpoint_confidence,
      endpointEvidenceSource: row.endpoint_evidence_source, endpointRegistryVersion: row.endpoint_registry_version,
      appInstalledAt: row.app_installed_at?.toISOString() ?? null,
      appLastUpdatedAt: row.app_last_updated_at?.toISOString() ?? null,
      isSystemApp: row.is_system_app ?? null, appVersionName: row.app_version_name, appVersionCode: row.app_version_code,
      consentId: row.consent_id, consentPurpose: row.consent_purpose,
      consentStatus: consentStatus(row.consent_action),
    }));
    const historyRecords = historyResult.rows.map(row => ({
      occurredAt: row.occurred_at.toISOString(), sourceApp: row.source_app,
      sourceAppName: row.source_app_name, destinationHost: row.destination_host,
    }));
    const continuity = collectionContinuity(await this.collectionEventsForDevice(deviceId), historyRecords);
    const baseline = buildBaselineAnalysis(historyRecords, new Date(), continuity);
    const weeklyDigest = buildWeeklyDigest(historyRecords, baseline, { matches: 0, estimatedValueCents: null });
    const functionCounts = buildFunctionCounts(rawObservations);
    const observations = rawObservations.map(observation => presentObservation(observation, functionCounts,
      baseline.byGroup.get(baselineGroupKey(observation.sourceApp, observation.destinationHost))));
    return {
      generatedAt: new Date().toISOString(), windowHours: 24,
      metrics: { observations: metrics.observations, distinctDomains: metrics.distinct_domains,
        review: observations.filter(observation => ['unexpected', 'unknown'].includes(observation.behaviorTier)).length,
        attributedApps: metrics.attributed_apps, attributedObservations: metrics.attributed_observations,
        verifiedObservations: metrics.verified_observations,
        attributionCoveragePercent: metrics.observations === 0 ? 0
          : Math.round(metrics.attributed_observations * 100 / metrics.observations) },
      consent: { permissionId: latestConsent?.permission_id ?? null, purpose: latestConsent?.purpose ?? null,
        status: consentStatus(latestConsent?.action), updatedAt: latestConsent?.occurred_at?.toISOString() ?? null },
      stability: baseline.stability,
      deviations: baseline.deviations,
      weeklyDigest,
      lastObservationAt: metrics.last_observation_at?.toISOString() ?? null,
      observations,
    };
  }
  async appendAudit(event: AuditEvent) {
    await this.pool.query('INSERT INTO audit_events(id,actor_id,action,target_type,target_id,outcome,occurred_at,correlation_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [event.id, event.actorId, event.action, event.targetType, event.targetId, event.outcome, event.occurredAt, event.correlationId, event.metadata]);
  }
  async adminControlCenterSnapshot(): Promise<AdminControlCenterAggregate> {
    const visible = `o.destination_host <> 'staging-api.datastorminc.live'
      AND o.destination_host !~ '\\.(in-addr|ip6)\\.arpa$'`;
    const [headlineResult, protocolsResult, attributionResult, signalsResult, failuresResult,
      deviceResult, registryResult, mappingsResult, consentResult, auditResult] = await Promise.all([
      this.pool.query(`SELECT count(*)::int connections_24h,count(DISTINCT o.destination_host)::int domains_24h,
        count(DISTINCT o.source_app) FILTER(WHERE o.source_app IS NOT NULL)::int identified_apps_24h,
        count(*) FILTER(WHERE o.classification IN('review','unpermissioned','unknown'))::int review_queue_24h
        FROM metadata_observations o WHERE ${visible} AND o.occurred_at>=now()-interval '24 hours'`),
      this.pool.query(`SELECT o.protocol,count(*)::int count FROM metadata_observations o
        WHERE ${visible} AND o.occurred_at>=now()-interval '24 hours' GROUP BY o.protocol ORDER BY count DESC`),
      this.pool.query(`SELECT count(*)::int total,
        count(*) FILTER(WHERE o.source_app IS NOT NULL)::int attributed,
        count(*) FILTER(WHERE o.attribution='verified')::int verified,
        count(*) FILTER(WHERE o.endpoint_signature_id IS NOT NULL)::int endpoint
        FROM metadata_observations o WHERE ${visible} AND o.occurred_at>=now()-interval '24 hours'`),
      this.pool.query(`SELECT signal,count(*)::int count FROM metadata_observations o,
        unnest(o.attribution_signals) signal WHERE ${visible} AND o.occurred_at>=now()-interval '24 hours'
        GROUP BY signal ORDER BY count DESC`),
      this.pool.query(`SELECT attribution_failure_reason reason,count(*)::int count FROM metadata_observations o
        WHERE ${visible} AND o.occurred_at>=now()-interval '24 hours' AND attribution_failure_reason IS NOT NULL
        GROUP BY attribution_failure_reason ORDER BY count DESC`),
      this.pool.query(`SELECT d.id,d.subject_id,d.platform,d.environment,d.app_version,d.created_at,d.revoked_at,
        max(o.occurred_at) last_seen_at,count(o.id) FILTER(WHERE o.occurred_at>=now()-interval '24 hours')::int observations_24h
        FROM devices d LEFT JOIN metadata_batches b ON b.device_id=d.id LEFT JOIN metadata_observations o ON o.batch_id=b.id
        GROUP BY d.id ORDER BY max(o.occurred_at) DESC NULLS LAST`),
      this.pool.query(`SELECT count(*) FILTER(WHERE record_status='active')::int total,
        count(*) FILTER(WHERE record_status='active' AND commercial_function<>'unknown')::int classified,
        count(*) FILTER(WHERE record_status='active' AND review_status='disputed')::int disputed,
        count(*) FILTER(WHERE record_status='active' AND commercial_function='unknown')::int unknown
        FROM domain_registry`),
      this.pool.query(`SELECT DISTINCT ON(dr.domain) dr.domain,dr.parent_company,dr.commercial_function,
        dr.confidence_score,dr.classification_source,dr.last_updated,dr.review_status
        FROM domain_registry dr WHERE dr.record_status='active' ORDER BY dr.domain,dr.record_version DESC LIMIT 100`),
      this.pool.query(`WITH latest AS(SELECT DISTINCT ON(device_id,subject_id,permission_id) device_id,subject_id,permission_id,activation_id,action,purpose
          FROM consent_events ORDER BY device_id,subject_id,permission_id,occurred_at DESC),
        observed AS(SELECT o.*,b.device_id,d.subject_id FROM metadata_observations o JOIN metadata_batches b ON b.id=o.batch_id
          JOIN devices d ON d.id=b.device_id WHERE ${visible} AND o.occurred_at>=now()-interval '24 hours')
        SELECT count(*)::int observations,count(*) FILTER(WHERE l.action='grant' AND l.purpose=observed.consent_purpose)::int linked,
          (SELECT count(*)::int FROM latest WHERE action='grant') active_monitoring,
          (SELECT count(*)::int FROM(SELECT DISTINCT ON(subject_id,grant_id) action,expires_at FROM commercial_consent_events
            ORDER BY subject_id,grant_id,occurred_at DESC)c WHERE action='grant' AND expires_at>now()) active_commercial
        FROM observed LEFT JOIN latest l ON l.device_id=observed.device_id AND l.subject_id=observed.subject_id AND l.activation_id=observed.consent_id`),
      this.pool.query(`SELECT occurred_at,action,outcome,target_type FROM audit_events
        ORDER BY occurred_at DESC LIMIT 20`),
    ]);
    const attribution = attributionResult.rows[0] ?? { total: 0, attributed: 0, verified: 0, endpoint: 0 };
    const devices = await Promise.all(deviceResult.rows.map(async row => {
      const engine = await this.engineSnapshot(row.id, row.subject_id, 1);
      return { id: row.id, platform: row.platform, environment: row.environment, appVersion: row.app_version,
        createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null,
        lastSeenAt: row.last_seen_at?.toISOString() ?? null, observations24h: row.observations_24h,
        collectorState: engine.stability.collectorState, verifiedHours: engine.stability.verifiedHours,
        targetHours: 168 as const, remainingHours: engine.stability.remainingHours,
        baselineConfidence: engine.stability.confidence, baselinePhase: engine.stability.phase,
        resumeCount: engine.stability.resumeCount, lastInterruption: engine.stability.lastInterruption };
    }));
    const headline = headlineResult.rows[0];
    const registry = registryResult.rows[0];
    const consent = consentResult.rows[0] ?? { observations: 0, linked: 0, active_monitoring: 0, active_commercial: 0 };
    return {
      generatedAt: new Date().toISOString(),
      headline: { connections24h: headline.connections_24h, domains24h: headline.domains_24h,
        identifiedApps24h: headline.identified_apps_24h, reviewQueue24h: headline.review_queue_24h },
      protocols: protocolsResult.rows.map(row => ({ name: row.protocol, count: row.count })),
      attribution: { attributedObservations: attribution.attributed, verifiedObservations: attribution.verified,
        coveragePercent: attribution.total ? Math.round(attribution.attributed * 1000 / attribution.total) / 10 : 0,
        endpointEvidencePercent: attribution.total ? Math.round(attribution.endpoint * 1000 / attribution.total) / 10 : null,
        signals: signalsResult.rows.map(row => ({ name: row.signal, count: row.count })),
        failures: failuresResult.rows.map(row => ({ reason: row.reason, count: row.count })) },
      devices,
      registry: { totalDomains: registry.total, classifiedDomains: registry.classified,
        disputedDomains: registry.disputed, unknownDomains: registry.unknown,
        mappings: mappingsResult.rows.map(row => ({ domain: row.domain, company: row.parent_company,
          function: row.commercial_function, confidence: row.confidence_score, source: row.classification_source,
          lastUpdated: row.last_updated.toISOString(), reviewStatus: row.review_status })) },
      consentAudit: { observations: consent.observations, linkedObservations: consent.linked,
        linkagePercent: consent.observations ? Math.round(consent.linked * 1000 / consent.observations) / 10 : 100,
        activeMonitoringGrants: consent.active_monitoring, activeCommercialGrants: consent.active_commercial,
        events: auditResult.rows.map(row => ({ time: row.occurred_at.toISOString(), event: row.action,
          outcome: row.outcome, evidence: row.target_type })) },
    };
  }
  private ensureContinuitySchema() {
    if (!this.continuitySchemaReady) {
      this.continuitySchemaReady = this.pool.query(`CREATE TABLE IF NOT EXISTS collection_events (
          id uuid PRIMARY KEY,device_id uuid NOT NULL REFERENCES devices(id),session_id uuid NOT NULL,
          event_type text NOT NULL CHECK(event_type IN('session_started','heartbeat','session_stopped','vpn_revoked','crash_detected')),
          occurred_at timestamptz NOT NULL,reason text,last_heartbeat_at timestamptz,app_version text NOT NULL,
          received_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS collection_events_device_time_idx ON collection_events(device_id,occurred_at,received_at);
        REVOKE UPDATE,DELETE ON collection_events FROM PUBLIC;`).then(() => undefined);
    }
    return this.continuitySchemaReady;
  }
  async close() { await this.pool.end(); }
}

async function insertObservation(client: PoolClient, batchId: string, deviceId: string, observation: Observation) {
  const appInstanceId = await upsertAppInstance(client, deviceId, observation);
  const domainRegistryId = await upsertDomainRegistry(client, observation.destinationHost);
  await client.query(`INSERT INTO metadata_observations(
      id,batch_id,consent_id,occurred_at,source_app,source_app_name,source_app_category,attribution,
      destination_host,protocol,bytes_bucket,classification,consent_purpose,attribution_method,
      source_uid,attribution_failure_reason,attribution_signals,attribution_lookup_attempts,
      shared_uid_package_count,app_signing_certificate_sha256,
      endpoint_signature_id,endpoint_role,endpoint_purpose,endpoint_confidence,endpoint_evidence_source,endpoint_registry_version,
      app_installed_at,app_last_updated_at,is_system_app,app_version_name,app_version_code,app_instance_id,domain_registry_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
    [observation.eventId, batchId, observation.consentId, observation.occurredAt, observation.sourceApp,
      observation.sourceAppName, observation.sourceAppCategory, observation.attribution, observation.destinationHost,
      observation.protocol, observation.bytesBucket, observation.classification, observation.consentPurpose,
      observation.attributionMethod, observation.sourceUid, observation.attributionFailureReason,
      observation.attributionSignals, observation.attributionLookupAttempts, observation.sharedUidPackageCount,
      observation.appSigningCertificateSha256, observation.endpointSignatureId, observation.endpointRole,
      observation.endpointPurpose, observation.endpointConfidence, observation.endpointEvidenceSource,
      observation.endpointRegistryVersion, observation.appInstalledAt, observation.appLastUpdatedAt,
      observation.isSystemApp, observation.appVersionName, observation.appVersionCode, appInstanceId, domainRegistryId]);
  if (domainRegistryId) {
    await client.query(`INSERT INTO domain_registry_observation_history(
        domain_registry_id,observed_date,observation_count,distinct_app_count,first_observed_at,last_observed_at)
        VALUES($1,$2::timestamptz::date,1,$3,$2,$2)
        ON CONFLICT(domain_registry_id,observed_date) DO UPDATE SET
          observation_count=domain_registry_observation_history.observation_count+1,
          distinct_app_count=(SELECT count(DISTINCT source_app)::int FROM metadata_observations
            WHERE domain_registry_id=$1 AND occurred_at::date=$2::timestamptz::date AND source_app IS NOT NULL),
          first_observed_at=LEAST(domain_registry_observation_history.first_observed_at,EXCLUDED.first_observed_at),
          last_observed_at=GREATEST(domain_registry_observation_history.last_observed_at,EXCLUDED.last_observed_at)`,
      [domainRegistryId, observation.occurredAt, observation.sourceApp ? 1 : 0]);
  }
  if (appInstanceId) await upsertBehaviorBaseline(client, deviceId, appInstanceId, domainRegistryId, observation);
}

async function upsertAppInstance(client: PoolClient, deviceId: string, observation: Observation) {
  if (!observation.sourceApp) return null;
  const id = stableUuid(`app-instance:${deviceId}:${observation.sourceApp}`);
  await client.query(`INSERT INTO app_instances(
      id,device_id,package_name,app_name,app_category,installed_at,last_updated_at,is_system_app,
      app_version_name,app_version_code,signing_certificate_sha256,attribution_method,attribution_confidence,first_observed_at,last_observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
      ON CONFLICT(device_id,package_name) DO UPDATE SET
        app_name=EXCLUDED.app_name,app_category=EXCLUDED.app_category,
        installed_at=COALESCE(EXCLUDED.installed_at,app_instances.installed_at),
        last_updated_at=COALESCE(EXCLUDED.last_updated_at,app_instances.last_updated_at),
        is_system_app=COALESCE(EXCLUDED.is_system_app,app_instances.is_system_app),
        app_version_name=COALESCE(EXCLUDED.app_version_name,app_instances.app_version_name),
        app_version_code=COALESCE(EXCLUDED.app_version_code,app_instances.app_version_code),
        signing_certificate_sha256=COALESCE(EXCLUDED.signing_certificate_sha256,app_instances.signing_certificate_sha256),
        attribution_method=COALESCE(EXCLUDED.attribution_method,app_instances.attribution_method),
        attribution_confidence=GREATEST(app_instances.attribution_confidence,EXCLUDED.attribution_confidence),
        status='active',status_verified_at=EXCLUDED.last_observed_at,last_observed_at=EXCLUDED.last_observed_at,
        observation_count=app_instances.observation_count+1,record_version=app_instances.record_version+1`,
    [id, deviceId, observation.sourceApp, observation.sourceAppName ?? observation.sourceApp,
      observation.sourceAppCategory ?? 'other', observation.appInstalledAt, observation.appLastUpdatedAt,
      observation.isSystemApp, observation.appVersionName, observation.appVersionCode,
      observation.appSigningCertificateSha256, observation.attributionMethod,
      attributionConfidence(observation.attribution), observation.occurredAt]);
  return id;
}

async function upsertDomainRegistry(client: PoolClient, destinationHost: string) {
  const intelligence = enrichDomain(destinationHost);
  if (!intelligence.registryId || !intelligence.matchedDomain) return null;
  await client.query(`INSERT INTO domain_registry(
      id,domain,parent_company,service_brand,corporate_parent_legal_name,corporate_parent_verification_status,
      corporate_parent_verified_at,ownership_confidence,function_confidence,
      commercial_function,subcategory,purpose,data_category,confidence_score,
      classification_source,review_status,record_status,registry_version,record_version,first_seen,last_updated,evidence_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,$19,$20,$21)
      ON CONFLICT(id) DO NOTHING`,
    [intelligence.registryId, intelligence.matchedDomain, intelligence.parentCompany, intelligence.company,
      intelligence.corporateParentLegalName, intelligence.corporateParentVerificationStatus,
      intelligence.corporateParentVerifiedAt, intelligence.ownershipConfidence, intelligence.functionConfidence,
      intelligence.commercialFunction, intelligence.subcategory, intelligence.purpose, intelligence.dataCategory,
      intelligence.confidence, intelligence.classificationSource, intelligence.reviewStatus, intelligence.recordStatus,
      intelligence.registryVersion, intelligence.firstSeen, intelligence.lastUpdated,
      createHash('sha256').update(intelligence.evidence).digest('hex')]);
  for (const evidence of intelligence.evidenceSources) {
    const evidenceId = stableUuid(`domain-evidence:${intelligence.registryId}:${evidence.type}:${evidence.detail}`);
    await client.query(`INSERT INTO domain_registry_evidence(
        id,domain_registry_id,evidence_type,source_reference,source_authority,detail,recorded_at,
        expires_at,evidence_weight,supports_claim,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) ON CONFLICT(id) DO NOTHING`,
      [evidenceId, intelligence.registryId, evidence.type, evidence.sourceReference ?? null,
        evidence.sourceAuthority ?? null, evidence.detail, evidence.recordedAt, evidence.expiresAt ?? null,
        ownershipEvidenceWeight(evidence.type),
        createHash('sha256').update(evidence.detail).digest('hex')]);
  }
  return intelligence.registryId;
}

async function upsertBehaviorBaseline(
  client: PoolClient,
  deviceId: string,
  appInstanceId: string,
  domainRegistryId: string | null,
  observation: Observation,
) {
  await client.query(`INSERT INTO behavior_baselines(
      device_id,app_instance_id,baseline_start,baseline_end,total_observations,observed_days,maturity,
      baseline_confidence,last_calculated_at,algorithm_version)
      VALUES($1,$2,$3,$3,1,1,'building',9,$3,'baseline-v1')
      ON CONFLICT(device_id,app_instance_id) DO UPDATE SET
        baseline_end=GREATEST(behavior_baselines.baseline_end,EXCLUDED.baseline_end),
        total_observations=behavior_baselines.total_observations+1,last_calculated_at=EXCLUDED.last_calculated_at`,
    [deviceId, appInstanceId, observation.occurredAt]);
  await client.query(`INSERT INTO behavior_baseline_daily(device_id,app_instance_id,observed_date,observation_count)
      VALUES($1,$2,$3::timestamptz::date,1)
      ON CONFLICT(device_id,app_instance_id,observed_date) DO UPDATE SET
        observation_count=behavior_baseline_daily.observation_count+1`,
    [deviceId, appInstanceId, observation.occurredAt]);
  await client.query(`UPDATE behavior_baselines SET
      observed_days=d.day_count,
      maturity=CASE WHEN d.day_count>=7 THEN 'mature' ELSE 'building' END,
      baseline_confidence=CASE WHEN d.day_count<7 THEN round((d.day_count::numeric/7)*60)::int
        WHEN d.day_count<30 THEN round(60+((d.day_count-7)::numeric/23)*30)::int ELSE 95 END
      FROM (SELECT count(*)::int AS day_count FROM behavior_baseline_daily
        WHERE device_id=$1 AND app_instance_id=$2) d
      WHERE behavior_baselines.device_id=$1 AND behavior_baselines.app_instance_id=$2`,
    [deviceId, appInstanceId]);
  await client.query(`INSERT INTO behavior_baseline_destinations(
      device_id,app_instance_id,destination_host,domain_registry_id,first_seen,last_seen,total_observations)
      VALUES($1,$2,$3,$4,$5,$5,1)
      ON CONFLICT(device_id,app_instance_id,destination_host) DO UPDATE SET
        domain_registry_id=COALESCE(EXCLUDED.domain_registry_id,behavior_baseline_destinations.domain_registry_id),
        last_seen=GREATEST(behavior_baseline_destinations.last_seen,EXCLUDED.last_seen),
        total_observations=behavior_baseline_destinations.total_observations+1`,
    [deviceId, appInstanceId, observation.destinationHost, domainRegistryId, observation.occurredAt]);
  await client.query(`INSERT INTO behavior_baseline_hourly(
      device_id,app_instance_id,bucket_start,observation_count,bytes_bucket_counts)
      VALUES($1,$2,date_trunc('hour',$3::timestamptz),1,jsonb_build_object($4::text,1))
      ON CONFLICT(device_id,app_instance_id,bucket_start) DO UPDATE SET
        observation_count=behavior_baseline_hourly.observation_count+1,
        bytes_bucket_counts=behavior_baseline_hourly.bytes_bucket_counts ||
          jsonb_build_object($4::text,COALESCE((behavior_baseline_hourly.bytes_bucket_counts->>($4::text))::int,0)+1)`,
    [deviceId, appInstanceId, observation.occurredAt, observation.bytesBucket]);
}
function mapConsent(row: Record<string, unknown>): ConsentEvent {
  return { id: String(row.id), deviceId: String(row.device_id), subjectId: String(row.subject_id),
    permissionId: String(row.permission_id), vaultId: row.vault_id == null ? null : String(row.vault_id), activationId: row.activation_id == null ? null : String(row.activation_id), activationVaultId: row.activation_vault_id == null ? null : String(row.activation_vault_id), activationRequestId: row.activation_request_id == null ? null : String(row.activation_request_id), action: row.action as ConsentEvent['action'], purpose: String(row.purpose),
    policyVersion: String(row.policy_version), purposeVersion: String(row.purpose_version),
    occurredAt: (row.occurred_at as Date).toISOString(), correlationId: String(row.correlation_id) };
}
function consentStatus(action?: ConsentEvent['action']): 'active' | 'inactive' | 'missing' {
  if (!action) return 'missing';
  return action === 'grant' ? 'active' : 'inactive';
}
function isVisibleDestination(host: string) {
  return host !== 'staging-api.datastorminc.live' && !/\.(?:in-addr|ip6)\.arpa$/.test(host);
}

function collectionContinuity(
  events: CollectionEvent[],
  records: Array<{ occurredAt: string }>,
): BaselineContinuity | null {
  if (events.length === 0) return null;
  const interruptionTypes = new Map<CollectionEventType, BaselineInterruptionKind>([
    ['crash_detected', 'crash'],
    ['session_stopped', 'stopped'],
    ['vpn_revoked', 'revoked'],
  ]);
  const sortedEvents = [...events]
    .filter(event => Number.isFinite(Date.parse(event.occurredAt)))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const starts = sortedEvents.filter(event => event.eventType === 'session_started');
  if (starts.length === 0) return null;
  const interruptions = sortedEvents.filter(event => interruptionTypes.has(event.eventType));
  const latestInterruptionEvent = interruptions.at(-1) ?? null;
  const lastInterruption = latestInterruptionEvent ? {
    kind: latestInterruptionEvent.eventType === 'crash_detected'
      && latestInterruptionEvent.reason?.includes('capacity')
      ? 'capacity' as const
      : interruptionTypes.get(latestInterruptionEvent.eventType)!,
    occurredAt: latestInterruptionEvent.occurredAt,
    reason: latestInterruptionEvent.reason ?? 'collector_continuity_interrupted',
  } : null;

  const recordTimes = records
    .map(record => Date.parse(record.occurredAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  let accumulatedVerifiedMs = 0;
  let verifiedThroughMs = Number.NaN;

  starts.forEach((start, index) => {
    const startMs = Date.parse(start.occurredAt);
    const nextStartMs = starts[index + 1] ? Date.parse(starts[index + 1]!.occurredAt) : Number.POSITIVE_INFINITY;
    const closingEvent = sortedEvents.find(event => event.sessionId === start.sessionId
      && interruptionTypes.has(event.eventType)
      && Date.parse(event.occurredAt) >= startMs);
    const closingMs = closingEvent
      ? Math.min(Date.parse(closingEvent.occurredAt), nextStartMs)
      : nextStartMs;
    const evidenceTimes = [startMs];

    for (const event of sortedEvents) {
      if (event.sessionId !== start.sessionId) continue;
      const occurredAt = Date.parse(event.occurredAt);
      if (event.eventType !== 'crash_detected' && occurredAt >= startMs && occurredAt <= closingMs) {
        evidenceTimes.push(occurredAt);
      }
      if (event.lastHeartbeatAt) {
        const heartbeatAt = Date.parse(event.lastHeartbeatAt);
        if (heartbeatAt >= startMs && heartbeatAt <= closingMs) evidenceTimes.push(heartbeatAt);
      }
    }
    for (const recordAt of recordTimes) {
      if (recordAt >= startMs && recordAt <= closingMs) evidenceTimes.push(recordAt);
    }

    const sessionVerifiedThroughMs = Math.max(...evidenceTimes.filter(Number.isFinite));
    if (Number.isFinite(sessionVerifiedThroughMs)) {
      accumulatedVerifiedMs += Math.max(0, sessionVerifiedThroughMs - startMs);
      verifiedThroughMs = Number.isFinite(verifiedThroughMs)
        ? Math.max(verifiedThroughMs, sessionVerifiedThroughMs)
        : sessionVerifiedThroughMs;
    }
  });

  const latestStart = starts.at(-1)!;
  const latestStartMs = Date.parse(latestStart.occurredAt);
  const latestSessionInterrupted = sortedEvents.some(event => event.sessionId === latestStart.sessionId
    && interruptionTypes.has(event.eventType)
    && Date.parse(event.occurredAt) >= latestStartMs);
  const isActive = !latestSessionInterrupted;
  return {
    segmentStartedAt: starts[0]!.occurredAt,
    activeSessionStartedAt: isActive ? latestStart.occurredAt : null,
    verifiedThroughAt: Number.isFinite(verifiedThroughMs)
      ? new Date(verifiedThroughMs).toISOString()
      : starts[0]!.occurredAt,
    accumulatedVerifiedMs,
    isActive,
    resumeCount: Math.max(0, starts.length - 1),
    lastInterruption,
  };
}

type PresentationInput = {
  deviceId: string; eventId: string;
  destinationHost: string; firstObservedAt: string; lastObservedAt: string; frequency: number;
  sourceApp: string | null; sourceAppName: string | null; sourceAppCategory: string | null;
  attribution: Observation['attribution']; attributionMethod: Observation['attributionMethod'];
  appInstalledAt: string | null; appLastUpdatedAt: string | null; isSystemApp: boolean | null;
  appVersionName: string | null; appVersionCode: string | null;
  endpointSignatureId: string | null; endpointRole: EndpointRole | null;
  endpointPurpose: string | null; endpointConfidence: number | null;
  endpointEvidenceSource: EndpointEvidenceSource | null; endpointRegistryVersion: string | null;
  protocol: Observation['protocol']; bytesBucket: string; classification: string;
  consentId: string; consentPurpose: string; consentStatus: EngineObservation['consentStatus'];
};

function groupKey(sourceApp: string | null, destinationHost: string) {
  return `${sourceApp ?? 'unknown'}\u0000${destinationHost}`;
}

function functionKey(sourceApp: string | null, commercialFunction: CommercialFunction) {
  return `${sourceApp ?? 'unknown'}\u0000${commercialFunction}`;
}

function buildFunctionCounts(records: Array<{ sourceApp: string | null; destinationHost: string }>) {
  const domains = new Map<string, Set<string>>();
  for (const record of records) {
    const intelligence = enrichDomain(record.destinationHost);
    const key = functionKey(record.sourceApp, intelligence.commercialFunction);
    const set = domains.get(key) ?? new Set<string>();
    set.add(record.destinationHost);
    domains.set(key, set);
  }
  return new Map([...domains].map(([key, values]) => [key, values.size]));
}

function presentObservation(input: PresentationInput, functionCounts: Map<string, number>, baseline?: ObservationBaseline): EngineObservation {
  const intelligence = enrichDomain(input.destinationHost);
  const appName = input.sourceAppName ?? (input.sourceApp ? 'Identified app' : 'App not yet identified');
  const count = functionCounts.get(functionKey(input.sourceApp, intelligence.commercialFunction)) ?? 1;
  const functionLabel = intelligence.commercialFunction === 'unknown' ? 'unclassified' : intelligence.commercialFunction;
  const appEvidence = input.attribution === 'verified'
    ? 'Android verified the connection owner for this VPN-observed flow.'
    : input.attribution === 'best_effort'
      ? 'Android associated the connection with a shared app identity.'
      : 'Android could not identify the connection owner for this observation.';
  const behavior = baseline ?? fallbackBaseline(input);
  const hasSharingConsent = input.consentStatus === 'active'
    && /(compensat|marketplace|share|sharing)/i.test(input.consentPurpose);
  const compensationEligible = hasSharingConsent
    && behavior.valuePotential !== 'not_assessed'
    && combinedConfidence(input.attribution, intelligence.confidence) >= 75;
  const eligibilityReason = compensationEligible
    ? 'Potentially eligible under the active sharing permission; buyer requirements still apply.'
    : behavior.valuePotential === 'not_assessed'
      ? 'Routine or unverified activity is not assessed for compensation.'
      : hasSharingConsent
        ? 'More verified evidence is required before opportunity matching.'
        : 'A separate purpose-specific sharing permission is required before opportunity matching.';
  const { deviceId: _deviceId, eventId: _eventId, ...publicInput } = input;
  return {
    ...publicInput,
    ...behavior,
    observationId: input.eventId,
    observedAt: input.lastObservedAt,
    appInstanceId: input.sourceApp ? stableUuid(`app-instance:${input.deviceId}:${input.sourceApp}`) : null,
    domainRegistryId: intelligence.registryId,
    destinationDomain: input.destinationHost,
    requestFrequency: input.frequency,
    company: intelligence.company,
    corporateParentLegalName: intelligence.corporateParentLegalName,
    corporateParentVerificationStatus: intelligence.corporateParentVerificationStatus,
    ownershipConfidence: intelligence.ownershipConfidence,
    functionConfidence: intelligence.functionConfidence,
    commercialFunction: intelligence.commercialFunction,
    domainSubcategory: intelligence.subcategory,
    domainClassificationSource: intelligence.classificationSource,
    domainReviewStatus: intelligence.reviewStatus,
    purpose: intelligence.purpose,
    dataCategory: intelligence.dataCategory,
    appConfidence: attributionConfidence(input.attribution),
    domainConfidence: intelligence.confidence,
    confidence: combinedConfidence(input.attribution, intelligence.confidence),
    evidence: `${appEvidence} ${intelligence.evidence}`,
    typicality: intelligence.typicality,
    registryVersion: intelligence.registryVersion,
    isValueCandidate: behavior.valuePotential !== 'not_assessed',
    reviewStatus: behavior.behaviorTier === 'unexpected' ? 'flagged' : 'observed',
    compensationEligible,
    eligibilityReason,
    plainLanguageSummary: `${appName} contacted ${intelligence.company} ${input.frequency} time${input.frequency === 1 ? '' : 's'} in the last 24 hours. Likely purpose: ${intelligence.purpose.toLowerCase()}.`,
    behaviorSummary: `${appName} contacted ${count} ${functionLabel} domain${count === 1 ? '' : 's'} in the last 24 hours.`,
  };
}

function fallbackBaseline(input: PresentationInput): ObservationBaseline {
  const intelligence = enrichDomain(input.destinationHost);
  const unknown = !input.sourceApp || intelligence.commercialFunction === 'unknown';
  const operational = ['infrastructure', 'content_delivery', 'security'].includes(intelligence.commercialFunction);
  return {
    behaviorTier: unknown ? 'unknown' : operational ? 'operational' : 'behavioral',
    baselineStatus: 'learning', baselineConfidence: 0,
    expectedFrequencyMin: null, expectedFrequencyMax: null,
    deviationSeverity: null, deviationReason: null, baselineDelta: 'learning', firstSeenAt: input.firstObservedAt,
    duplicateAlert: null, signatureId: 'pending',
    commercialIntentScore: 0, valuePotential: 'not_assessed', buyerCategory: null,
    evidenceNeeded: unknown ? 'More verified app and destination evidence.' : null,
    whyThisMatters: operational
      ? 'This supports routine app operation and is shown as context rather than an alert.'
      : unknown
        ? 'KICK’S needs more verified evidence before explaining this communication.'
        : 'This may be commercially relevant; separate sharing consent is still required.',
    whyTags: operational ? ['Stability'] : unknown ? ['Needs evidence'] : ['Privacy'],
  };
}

function stableUuid(value: string) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left); const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function mapReceipt(row:any):ValueReceipt{return{id:row.id,transactionId:row.transaction_id,opportunityId:row.opportunity_id,licenseId:row.license_id,grossCents:Number(row.gross_cents),platformFeeCents:Number(row.platform_fee_cents),consumerProceedsCents:Number(row.consumer_proceeds_cents),currency:row.currency,buyerName:row.buyer_name,purpose:row.purpose,status:row.status,createdAt:row.created_at instanceof Date?row.created_at.toISOString():row.created_at};}
