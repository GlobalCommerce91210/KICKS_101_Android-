export type EngineMode = 'development' | 'staging' | 'production';
export type IntentBand = 'low' | 'medium' | 'high';
export type ValueScope = 'event' | 'session' | 'digest';

export type EnginePolicyConfig = {
  mode: EngineMode;
  version: '1.0.0';
  system: {
    collectorHealthMin: number;
    baselineDaysMin: number;
    baselineStabilityMin: number;
    destinationFrequencyStabilityMin: number;
    digestGenerationEnabled: boolean;
    compensationEnabled: boolean;
  };
  attribution: {
    appConfidenceMin: number;
    domainConfidenceMin: number;
    endpointConfidenceMin: number;
    anomalyTruePositiveMin: number;
  };
  classification: {
    commercialIntentConfidenceMin: number;
    categoryThresholds: { lowIntentMax: 30; mediumIntentMin: 31; mediumIntentMax: 70; highIntentMin: 71 };
  };
  metadataValue: {
    eventValueMinCents: number; eventValueMaxCents: number;
    sessionValueMinCents: number; sessionValueMaxCents: number;
    digestValueMinCents: number; digestValueMaxCents: number;
    weighting: { buyerDemand: 0.5; rarity: 0.3; commercialRelevance: 0.2 };
  };
  ui: {
    userEventDisplayConfidenceMin: number;
    showExplainability: boolean; showPersonas: boolean; showValueEstimates: boolean; showIntentScores: boolean;
  };
  digest: {
    includeHighValueEventsOnly: boolean; includeNewDomains: boolean; includeAnomalies: boolean;
    minConfidenceForInclusion: number; weeklyDigestEnabled: boolean;
  };
  compensation: { eligibilityConfidenceMin: 0.95; buyerMatchingEnabled: boolean; auditLoggingEnabled: boolean };
  logging: {
    enableEventLogging: boolean; enableAnomalyLogging: boolean; enableSignatureUpdates: boolean;
    logLevel: 'info' | 'debug' | 'trace';
  };
};

export type ProductionReadiness = {
  privacyReviewApproved: boolean;
  securityReviewApproved: boolean;
  kycReady: boolean;
  settlementReady: boolean;
  verifiedBuyerSpecs: boolean;
  productionSigningReady: boolean;
  auditRetentionReady: boolean;
};

export type EnginePolicyInput = {
  requestedMode: EngineMode;
  manualProductionApproval: boolean;
  collectorHealth: number;
  baselineDays: number;
  baselineStability: number;
  destinationFrequencyStability: number;
  appConfidence: number;
  domainConfidence: number;
  endpointConfidence: number | null;
  anomalyTruePositiveRate: number | null;
  productionReadiness: ProductionReadiness;
  compensationExecutionEnabled: boolean;
};

export type EnginePolicyDecision = {
  version: '1.0.0';
  requestedMode: EngineMode;
  selectedMode: EngineMode;
  selectionReason: string;
  inputs: Omit<EnginePolicyInput, 'productionReadiness'> & { productionReadinessPassed: boolean };
  thresholds: EnginePolicyConfig;
  gates: {
    digestGeneration: boolean;
    consumerEventDisplay: boolean;
    personas: boolean;
    intentScores: boolean;
    valueEstimates: boolean;
    buyerMatching: boolean;
    compensationExecution: boolean;
  };
  blockers: string[];
};

type GovernableObservation = {
  confidence: number; appConfidence: number; functionConfidence: number;
  endpointConfidence: number | null; commercialIntentScore: number;
  commercialFunction: string; behaviorTier: string; compensationEligible: boolean;
};

type GovernableSnapshot = {
  generatedAt: string;
  metrics: { observations: number; verifiedObservations: number };
  stability: {
    verifiedHours: number; confidence: number; segmentStartedAt: string | null;
    daily: Array<{ count: number; isToday: boolean }>;
  };
  observations: GovernableObservation[];
  weeklyDigest: Record<string, unknown>;
};

const shared = {
  version: '1.0.0' as const,
  classification: {
    categoryThresholds: { lowIntentMax: 30 as const, mediumIntentMin: 31 as const, mediumIntentMax: 70 as const, highIntentMin: 71 as const },
  },
  metadataValue: {
    eventValueMinCents: 1, eventValueMaxCents: 500,
    sessionValueMinCents: 10, sessionValueMaxCents: 2_000,
    digestValueMinCents: 100, digestValueMaxCents: 5_000,
    weighting: { buyerDemand: 0.5 as const, rarity: 0.3 as const, commercialRelevance: 0.2 as const },
  },
};

export const ENGINE_POLICY_PROFILES: Record<EngineMode, EnginePolicyConfig> = {
  production: {
    mode: 'production', version: shared.version,
    system: { collectorHealthMin: .99, baselineDaysMin: 7, baselineStabilityMin: .85, destinationFrequencyStabilityMin: .90, digestGenerationEnabled: true, compensationEnabled: true },
    attribution: { appConfidenceMin: .95, domainConfidenceMin: .92, endpointConfidenceMin: .93, anomalyTruePositiveMin: .85 },
    classification: { commercialIntentConfidenceMin: .90, ...shared.classification },
    metadataValue: shared.metadataValue,
    ui: { userEventDisplayConfidenceMin: .90, showExplainability: true, showPersonas: true, showValueEstimates: true, showIntentScores: true },
    digest: { includeHighValueEventsOnly: true, includeNewDomains: true, includeAnomalies: true, minConfidenceForInclusion: .90, weeklyDigestEnabled: true },
    compensation: { eligibilityConfidenceMin: .95, buyerMatchingEnabled: true, auditLoggingEnabled: true },
    logging: { enableEventLogging: true, enableAnomalyLogging: true, enableSignatureUpdates: true, logLevel: 'info' },
  },
  staging: {
    mode: 'staging', version: shared.version,
    system: { collectorHealthMin: .95, baselineDaysMin: 5, baselineStabilityMin: .75, destinationFrequencyStabilityMin: .80, digestGenerationEnabled: true, compensationEnabled: false },
    attribution: { appConfidenceMin: .85, domainConfidenceMin: .80, endpointConfidenceMin: .82, anomalyTruePositiveMin: .70 },
    classification: { commercialIntentConfidenceMin: .80, ...shared.classification },
    metadataValue: shared.metadataValue,
    ui: { userEventDisplayConfidenceMin: .80, showExplainability: true, showPersonas: true, showValueEstimates: true, showIntentScores: true },
    digest: { includeHighValueEventsOnly: false, includeNewDomains: true, includeAnomalies: true, minConfidenceForInclusion: .80, weeklyDigestEnabled: true },
    compensation: { eligibilityConfidenceMin: .95, buyerMatchingEnabled: false, auditLoggingEnabled: true },
    logging: { enableEventLogging: true, enableAnomalyLogging: true, enableSignatureUpdates: true, logLevel: 'debug' },
  },
  development: {
    mode: 'development', version: shared.version,
    system: { collectorHealthMin: .80, baselineDaysMin: 2, baselineStabilityMin: .50, destinationFrequencyStabilityMin: .60, digestGenerationEnabled: false, compensationEnabled: false },
    attribution: { appConfidenceMin: .60, domainConfidenceMin: .55, endpointConfidenceMin: .55, anomalyTruePositiveMin: .50 },
    classification: { commercialIntentConfidenceMin: .60, ...shared.classification },
    metadataValue: shared.metadataValue,
    ui: { userEventDisplayConfidenceMin: .60, showExplainability: true, showPersonas: true, showValueEstimates: true, showIntentScores: true },
    digest: { includeHighValueEventsOnly: false, includeNewDomains: true, includeAnomalies: true, minConfidenceForInclusion: .60, weeklyDigestEnabled: false },
    compensation: { eligibilityConfidenceMin: .95, buyerMatchingEnabled: false, auditLoggingEnabled: false },
    logging: { enableEventLogging: true, enableAnomalyLogging: true, enableSignatureUpdates: true, logLevel: 'trace' },
  },
};

export function validateEnginePolicyProfiles() {
  const errors: string[] = [];
  for (const [name, config] of Object.entries(ENGINE_POLICY_PROFILES)) {
    if (name !== config.mode) errors.push(`${name}: mode mismatch`);
    for (const [key, value] of Object.entries({
      collectorHealthMin: config.system.collectorHealthMin,
      baselineStabilityMin: config.system.baselineStabilityMin,
      destinationFrequencyStabilityMin: config.system.destinationFrequencyStabilityMin,
      appConfidenceMin: config.attribution.appConfidenceMin,
      domainConfidenceMin: config.attribution.domainConfidenceMin,
      endpointConfidenceMin: config.attribution.endpointConfidenceMin,
      anomalyTruePositiveMin: config.attribution.anomalyTruePositiveMin,
      commercialIntentConfidenceMin: config.classification.commercialIntentConfidenceMin,
      userEventDisplayConfidenceMin: config.ui.userEventDisplayConfidenceMin,
      digestMinConfidence: config.digest.minConfidenceForInclusion,
      eligibilityConfidenceMin: config.compensation.eligibilityConfidenceMin,
    })) if (value < 0 || value > 1) errors.push(`${name}.${key}: outside 0..1`);
    const weights = config.metadataValue.weighting;
    if (Math.abs(weights.buyerDemand + weights.rarity + weights.commercialRelevance - 1) > .000001) errors.push(`${name}: value weights must total 1`);
    if (config.mode !== 'production' && (config.system.compensationEnabled || config.compensation.buyerMatchingEnabled)) errors.push(`${name}: non-production compensation must be disabled`);
    if (config.mode === 'production' && (!config.system.digestGenerationEnabled || config.attribution.appConfidenceMin < .95 || config.ui.userEventDisplayConfidenceMin < .90)) errors.push('production: safety minimum failed');
  }
  return errors;
}

const policyErrors = validateEnginePolicyProfiles();
if (policyErrors.length > 0) throw new Error(`Invalid KICK'S engine policy: ${policyErrors.join('; ')}`);

export function evaluateEnginePolicy(input: EnginePolicyInput): EnginePolicyDecision {
  const readinessPassed = Object.values(input.productionReadiness).every(Boolean);
  const production = ENGINE_POLICY_PROFILES.production;
  const staging = ENGINE_POLICY_PROFILES.staging;
  const blockers = productionBlockers(input, production);
  const manualProduction = input.manualProductionApproval
    && input.collectorHealth >= .99
    && input.baselineDays >= 7
    && input.baselineStability >= .85
    && input.destinationFrequencyStability >= .90
    && blockers.length === 0;
  const automaticProduction = input.collectorHealth >= .97
    && input.baselineDays >= 7
    && input.baselineStability >= .80
    && input.destinationFrequencyStability >= .85
    && blockers.length === 0;
  const stagingReady = input.collectorHealth >= .90
    && input.baselineDays >= 5
    && input.baselineStability >= .75
    && input.destinationFrequencyStability >= .80
    && input.appConfidence >= staging.attribution.appConfidenceMin
    && input.domainConfidence >= staging.attribution.domainConfidenceMin;

  let selectedMode: EngineMode = 'development';
  let selectionReason = 'Development safety fallback: the staging evidence thresholds are not yet complete.';
  if (manualProduction) {
    selectedMode = 'production';
    selectionReason = 'Production selected after strict evidence thresholds and explicit production approval passed.';
  } else if (automaticProduction) {
    selectedMode = 'production';
    selectionReason = 'Production selected after all evidence, attribution, operational, and readiness gates passed.';
  } else if (stagingReady) {
    selectedMode = 'staging';
    selectionReason = 'Staging selected: the system is mature enough for internal evaluation but production gates remain.';
  }
  if (input.collectorHealth < .80) {
    selectedMode = 'development';
    selectionReason = 'Hard safety fallback: collector health is below 0.80.';
  }

  const config = ENGINE_POLICY_PROFILES[selectedMode];
  const compensationExecution = selectedMode === 'production'
    && config.system.compensationEnabled
    && config.compensation.buyerMatchingEnabled
    && readinessPassed
    && input.compensationExecutionEnabled;
  return {
    version: '1.0.0', requestedMode: input.requestedMode, selectedMode, selectionReason,
    inputs: {
      requestedMode: input.requestedMode,
      manualProductionApproval: input.manualProductionApproval,
      collectorHealth: input.collectorHealth,
      baselineDays: input.baselineDays,
      baselineStability: input.baselineStability,
      destinationFrequencyStability: input.destinationFrequencyStability,
      appConfidence: input.appConfidence,
      domainConfidence: input.domainConfidence,
      endpointConfidence: input.endpointConfidence,
      anomalyTruePositiveRate: input.anomalyTruePositiveRate,
      compensationExecutionEnabled: input.compensationExecutionEnabled,
      productionReadinessPassed: readinessPassed,
    },
    thresholds: config,
    gates: {
      digestGeneration: config.system.digestGenerationEnabled && config.digest.weeklyDigestEnabled,
      consumerEventDisplay: input.appConfidence >= config.attribution.appConfidenceMin
        && input.domainConfidence >= config.attribution.domainConfidenceMin,
      personas: config.ui.showPersonas,
      intentScores: config.ui.showIntentScores,
      valueEstimates: config.ui.showValueEstimates,
      buyerMatching: compensationExecution,
      compensationExecution,
    },
    blockers: selectedMode === 'production' ? [] : blockers,
  };
}

export function governEngineSnapshot<T extends GovernableSnapshot>(
  snapshot: T,
  options: {
    requestedMode: EngineMode;
    manualProductionApproval: boolean;
    productionReadiness: ProductionReadiness;
    compensationExecutionEnabled: boolean;
    anomalyTruePositiveRate?: number | null;
  },
) {
  const domainValues = snapshot.observations.map(item => item.functionConfidence / 100);
  const endpointValues = snapshot.observations
    .map(item => item.endpointConfidence == null ? null : item.endpointConfidence / 100)
    .filter((value): value is number => value !== null);
  const segmentStartedMs = snapshot.stability.segmentStartedAt
    ? Date.parse(snapshot.stability.segmentStartedAt)
    : Number.NaN;
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const elapsedHours = Number.isFinite(segmentStartedMs) && Number.isFinite(generatedAtMs)
    ? Math.max(1, (generatedAtMs - segmentStartedMs) / 3_600_000)
    : 0;
  const input: EnginePolicyInput = {
    requestedMode: options.requestedMode,
    manualProductionApproval: options.manualProductionApproval,
    collectorHealth: elapsedHours === 0 ? 0 : roundRatio(snapshot.stability.verifiedHours / elapsedHours),
    baselineDays: Math.round((snapshot.stability.verifiedHours / 24) * 100) / 100,
    baselineStability: roundRatio(snapshot.stability.confidence / 100),
    destinationFrequencyStability: frequencyStability(snapshot.stability.daily),
    appConfidence: snapshot.metrics.observations === 0 ? 0
      : roundRatio(snapshot.metrics.verifiedObservations / snapshot.metrics.observations),
    domainConfidence: average(domainValues),
    endpointConfidence: endpointValues.length === 0 ? null : average(endpointValues),
    anomalyTruePositiveRate: options.anomalyTruePositiveRate ?? null,
    productionReadiness: options.productionReadiness,
    compensationExecutionEnabled: options.compensationExecutionEnabled,
  };
  const policy = evaluateEnginePolicy(input);
  const config = policy.thresholds;
  const observations = snapshot.observations.map(item => {
    const displayEligible = item.confidence / 100 >= config.ui.userEventDisplayConfidenceMin
      && item.appConfidence / 100 >= config.attribution.appConfidenceMin
      && item.functionConfidence / 100 >= config.attribution.domainConfidenceMin
      && (item.endpointConfidence === null || item.endpointConfidence / 100 >= config.attribution.endpointConfidenceMin);
    const intentEligible = item.commercialIntentScore / 100 >= config.classification.commercialIntentConfidenceMin;
    return {
      ...item,
      policyDecision: {
        consumerDisplayEligible: displayEligible,
        explainabilityStatus: displayEligible ? 'evidence_threshold_met' as const : 'needs_more_evidence' as const,
        persona: behaviorPersona(item),
        intentBand: intentBand(item.commercialIntentScore),
        intentScoreDisplayEligible: config.ui.showIntentScores && intentEligible,
        valueEstimateCents: null,
        valueEstimateStatus: 'verified_buyer_price_required' as const,
        compensationEligible: policy.gates.compensationExecution
          && item.compensationEligible
          && item.confidence / 100 >= config.compensation.eligibilityConfidenceMin,
      },
    };
  });
  return {
    ...snapshot,
    policy,
    weeklyDigest: {
      ...snapshot.weeklyDigest,
      policy: {
        generationEnabled: policy.gates.digestGeneration,
        highValueEventsOnly: config.digest.includeHighValueEventsOnly,
        minimumHighlightConfidence: config.digest.minConfidenceForInclusion,
        valueStatus: 'verified_buyer_price_required',
      },
    },
    observations,
  };
}

function productionBlockers(input: EnginePolicyInput, config: EnginePolicyConfig) {
  const blockers: string[] = [];
  const checks: Array<[boolean, string]> = [
    [input.collectorHealth >= config.system.collectorHealthMin, 'Collector health is below 0.99.'],
    [input.baselineDays >= config.system.baselineDaysMin, 'Seven verified baseline days are incomplete.'],
    [input.baselineStability >= config.system.baselineStabilityMin, 'Baseline stability is below 0.85.'],
    [input.destinationFrequencyStability >= config.system.destinationFrequencyStabilityMin, 'Destination-frequency stability is below 0.90.'],
    [input.appConfidence >= config.attribution.appConfidenceMin, 'Verified app-attribution quality is below 0.95.'],
    [input.domainConfidence >= config.attribution.domainConfidenceMin, 'Domain-function confidence is below 0.92.'],
    [input.endpointConfidence !== null && input.endpointConfidence >= config.attribution.endpointConfidenceMin, 'Endpoint confidence has not been validated at 0.93 or higher.'],
    [input.anomalyTruePositiveRate !== null && input.anomalyTruePositiveRate >= config.attribution.anomalyTruePositiveMin, 'Anomaly true-positive performance has not been validated at 0.85 or higher.'],
    [Object.values(input.productionReadiness).every(Boolean), 'Production privacy, security, KYC, settlement, buyer, signing, or audit readiness is incomplete.'],
    [input.compensationExecutionEnabled, 'Compensation execution remains administratively disabled.'],
  ];
  for (const [passed, reason] of checks) if (!passed) blockers.push(reason);
  return blockers;
}

export function intentBand(score: number): IntentBand {
  if (score <= 30) return 'low';
  if (score <= 70) return 'medium';
  return 'high';
}

export function behaviorPersona(input: { commercialFunction: string; commercialIntentScore: number; behaviorTier: string }) {
  if (input.behaviorTier === 'unknown') return 'Unknown';
  if (input.behaviorTier === 'operational') return 'Operational';
  if (input.behaviorTier === 'unexpected') return input.commercialIntentScore >= 71 ? 'Changed commercial behavior' : 'Changed behavior';
  if (input.commercialIntentScore >= 71) return 'Heavy commercial';
  if (input.commercialIntentScore >= 31) return 'Light commercial';
  return 'Mixed';
}

export function frequencyStability(daily: Array<{ count: number; isToday: boolean }>) {
  const counts = daily.filter(item => !item.isToday && item.count > 0).map(item => item.count);
  if (counts.length < 2) return 0;
  const mean = counts.reduce((total, count) => total + count, 0) / counts.length;
  if (mean === 0) return 0;
  const variance = counts.reduce((total, count) => total + (count - mean) ** 2, 0) / counts.length;
  return roundRatio(1 - Math.min(1, Math.sqrt(variance) / mean));
}

export function validateBuyerPricedValue(scope: ValueScope, amountCents: number, config: EnginePolicyConfig) {
  const range = scope === 'event'
    ? [config.metadataValue.eventValueMinCents, config.metadataValue.eventValueMaxCents]
    : scope === 'session'
      ? [config.metadataValue.sessionValueMinCents, config.metadataValue.sessionValueMaxCents]
      : [config.metadataValue.digestValueMinCents, config.metadataValue.digestValueMaxCents];
  return Number.isInteger(amountCents) && amountCents >= range[0]! && amountCents <= range[1]!;
}

export function weightedValueEvidence(input: { buyerDemand: number; rarity: number; commercialRelevance: number }) {
  return roundRatio(input.buyerDemand * .50 + input.rarity * .30 + input.commercialRelevance * .20);
}

export function roundRatio(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return roundRatio(values.reduce((total, value) => total + value, 0) / values.length);
}
