import { createHash } from 'node:crypto';
import { enrichDomain, type CommercialFunction } from './domain-intelligence.js';

export type BehaviorTier = 'operational' | 'behavioral' | 'unexpected' | 'unknown';
export type BaselinePhase = 'learning' | 'maturing' | 'stable';
export type BaselineStatus = 'learning' | 'expected' | 'deviation' | 'unknown';
export type DeviationSeverity = 'notice' | 'medium' | 'high';
export type ValuePotential = 'not_assessed' | 'emerging' | 'moderate' | 'high';
export type BaselineInterruptionKind = 'crash' | 'stopped' | 'revoked' | 'capacity';

export type BaselineContinuity = {
  segmentStartedAt: string | null;
  activeSessionStartedAt: string | null;
  verifiedThroughAt: string | null;
  accumulatedVerifiedMs: number;
  isActive: boolean;
  resumeCount: number;
  lastInterruption: {
    kind: BaselineInterruptionKind;
    occurredAt: string;
    reason: string;
  } | null;
};

export type BaselineRecord = {
  occurredAt: string;
  sourceApp: string | null;
  sourceAppName: string | null;
  destinationHost: string;
};

export type DailyBaselinePoint = {
  date: string;
  label: string;
  count: number;
  isToday: boolean;
};

export type StabilitySummary = {
  phase: BaselinePhase;
  observedDays: number;
  completedDays: number;
  targetDays: 7;
  journeyDay: number;
  journeyStatus: 'waiting' | 'learning' | 'complete' | 'paused' | 'resumed';
  continuousHours: number;
  verifiedHours: number;
  targetHours: 168;
  remainingHours: number;
  collectorState: 'waiting' | 'active' | 'paused';
  activeSessionStartedAt: string | null;
  resumeCount: number;
  segmentStartedAt: string | null;
  verifiedThroughAt: string | null;
  lastInterruption: BaselineContinuity['lastInterruption'];
  confidence: number;
  todayCount: number;
  dailyAverage: number | null;
  changePercent: number | null;
  status: 'waiting' | 'learning' | 'within_range' | 'above_range' | 'below_range';
  summary: string;
  daily: DailyBaselinePoint[];
};

export type DuplicateAlert = { count: number; windowMinutes: 10 };

export type ObservationBaseline = {
  behaviorTier: BehaviorTier;
  baselineStatus: BaselineStatus;
  baselineConfidence: number;
  expectedFrequencyMin: number | null;
  expectedFrequencyMax: number | null;
  deviationSeverity: DeviationSeverity | null;
  deviationReason: string | null;
  baselineDelta: 'learning' | 'first_observed_app' | 'new_destination' | 'new_purpose' | 'frequency_spike' | 'normal' | 'unknown';
  firstSeenAt: string;
  duplicateAlert: DuplicateAlert | null;
  signatureId: string;
  commercialIntentScore: number;
  valuePotential: ValuePotential;
  buyerCategory: string | null;
  evidenceNeeded: string | null;
  whyThisMatters: string;
  whyTags: string[];
};

export type BaselineDeviation = {
  id: string;
  severity: DeviationSeverity;
  title: string;
  explanation: string;
  appName: string;
  observedAt: string;
};

export type BaselineAnalysis = {
  stability: StabilitySummary;
  deviations: BaselineDeviation[];
  byGroup: Map<string, ObservationBaseline>;
};

export type WeeklyDigest = {
  scope: 'current_device';
  weekStart: string;
  weekEnd: string;
  observedDays: number;
  totalApps: number;
  totalDomains: number;
  totalObservations: number;
  operationalCount: number;
  behavioralCount: number;
  unexpectedCount: number;
  unknownCount: number;
  newTrackers: number;
  potentialValuePatterns: number;
  eligibleOpportunities: number;
  estimatedWeeklyValueCents: number | null;
  valueEstimateStatus: 'buyer_pricing_not_validated' | 'matched_buyer_pricing';
  topAppsByActivity: Array<{ app: string; communications: number }>;
  newDestinations: Array<{ company: string; domain: string; firstSeenAt: string; tier: BehaviorTier }>;
  generatedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TARGET_BASELINE_HOURS = 168 as const;
const TARGET_BASELINE_MS = TARGET_BASELINE_HOURS * HOUR_MS;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export function baselineGroupKey(sourceApp: string | null, destinationHost: string) {
  return `${sourceApp ?? 'unknown'}\u0000${destinationHost}`;
}

export function buildBaselineAnalysis(
  records: BaselineRecord[],
  now = new Date(),
  continuity: BaselineContinuity | null = null,
): BaselineAnalysis {
  const allUsable = records
    .filter(record => Number.isFinite(Date.parse(record.occurredAt)))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const segmentStartedMs = continuity?.segmentStartedAt ? Date.parse(continuity.segmentStartedAt) : Number.NaN;
  const usable = Number.isFinite(segmentStartedMs)
    ? allUsable.filter(record => Date.parse(record.occurredAt) >= segmentStartedMs)
    : allUsable;
  const today = utcDayKey(now);
  const observedDayKeys = [...new Set(usable.map(record => utcDayKey(new Date(record.occurredAt))))].sort();
  const observedDays = observedDayKeys.length;
  const reportedVerifiedThroughMs = continuity?.verifiedThroughAt ? Date.parse(continuity.verifiedThroughAt) : Number.NaN;
  const verifiedThroughMs = Number.isFinite(reportedVerifiedThroughMs)
    ? Math.min(reportedVerifiedThroughMs, now.getTime())
    : Number.NaN;
  const strictContinuity = Number.isFinite(segmentStartedMs) && Number.isFinite(verifiedThroughMs)
    && continuity !== null;
  const verifiedMs = strictContinuity ? Math.max(0, continuity.accumulatedVerifiedMs) : observedDays * DAY_MS;
  const completedDays = strictContinuity ? Math.min(7, Math.floor(verifiedMs / DAY_MS)) : observedDays;
  const journeyDay = strictContinuity ? Math.min(7, completedDays + 1) : Math.min(7, Math.max(1, observedDays));
  const phase = strictContinuity
    ? baselinePhaseForVerifiedTime(verifiedMs, observedDays)
    : baselinePhase(completedDays);
  const confidence = strictContinuity
    ? baselineConfidenceForVerifiedTime(verifiedMs, observedDays)
    : baselineConfidence(completedDays);
  const chartDays = lastUtcDays(now, 7);
  const deviceCounts = countBy(usable, record => utcDayKey(new Date(record.occurredAt)));
  const daily = chartDays.map(date => ({
    date,
    label: date === today ? 'Today' : weekdayLabel(date),
    count: deviceCounts.get(date) ?? 0,
    isToday: date === today,
  }));
  const todayCount = deviceCounts.get(today) ?? 0;
  const priorActiveDays = observedDayKeys.filter(day => day < today).slice(-7);
  const dailyAverage = phase === 'learning' || priorActiveDays.length === 0
    ? null
    : average(priorActiveDays.map(day => deviceCounts.get(day) ?? 0));
  const changePercent = dailyAverage && dailyAverage > 0
    ? Math.round(((todayCount - dailyAverage) / dailyAverage) * 100)
    : null;
  const status = stabilityStatus(completedDays, changePercent);
  const verifiedHours = strictContinuity ? Math.floor(verifiedMs / HOUR_MS) : completedDays * 24;
  const remainingHours = Math.max(0, Math.ceil((TARGET_BASELINE_MS - verifiedMs) / HOUR_MS));
  const stability: StabilitySummary = {
    phase, observedDays, completedDays, targetDays: 7, journeyDay,
    journeyStatus: completedDays >= 7
      ? 'complete'
      : observedDays === 0 && !continuity?.segmentStartedAt
        ? 'waiting'
        : continuity && !continuity.isActive
          ? 'paused'
          : continuity && continuity.resumeCount > 0
            ? 'resumed'
            : 'learning',
    continuousHours: verifiedHours,
    verifiedHours,
    targetHours: TARGET_BASELINE_HOURS,
    remainingHours,
    collectorState: continuity
      ? continuity.isActive ? 'active' : 'paused'
      : observedDays > 0 ? 'active' : 'waiting',
    activeSessionStartedAt: continuity?.activeSessionStartedAt ?? null,
    resumeCount: continuity?.resumeCount ?? 0,
    segmentStartedAt: continuity?.segmentStartedAt ?? null,
    verifiedThroughAt: continuity?.verifiedThroughAt ?? null,
    lastInterruption: continuity?.lastInterruption ?? null,
    confidence, todayCount,
    dailyAverage: dailyAverage == null ? null : Math.round(dailyAverage),
    changePercent, status, daily,
    summary: stabilitySummary(
      completedDays,
      dailyAverage,
      todayCount,
      changePercent,
      continuity,
      verifiedMs,
    ),
  };

  const grouped = groupRecords(usable);
  const priorApps = new Set(usable.filter(record => utcDayKey(new Date(record.occurredAt)) < today)
    .map(record => record.sourceApp).filter((value): value is string => Boolean(value)));
  const priorFunctionsByApp = new Map<string, Set<CommercialFunction>>();
  for (const record of usable.filter(item => utcDayKey(new Date(item.occurredAt)) < today)) {
    const app = record.sourceApp ?? 'unknown';
    const functions = priorFunctionsByApp.get(app) ?? new Set<CommercialFunction>();
    functions.add(enrichDomain(record.destinationHost).commercialFunction);
    priorFunctionsByApp.set(app, functions);
  }

  const byGroup = new Map<string, ObservationBaseline>();
  const deviations: BaselineDeviation[] = [];
  for (const [key, values] of grouped) {
    const latest = values.at(-1)!;
    const intelligence = enrichDomain(latest.destinationHost);
    const appName = latest.sourceAppName ?? (latest.sourceApp ? 'Identified app' : 'App not yet identified');
    const dayCounts = countBy(values, record => utcDayKey(new Date(record.occurredAt)));
    const priorCounts = priorActiveDays.map(day => dayCounts.get(day) ?? 0);
    const priorNonZero = priorCounts.filter(value => value > 0);
    const hasPriorDestination = priorNonZero.length > 0;
    const expectedFrequencyMin = phase === 'learning' || priorCounts.length === 0 ? null : Math.min(...priorCounts);
    const expectedFrequencyMax = phase === 'learning' || priorCounts.length === 0 ? null : Math.max(...priorCounts);
    const todayFrequency = dayCounts.get(today) ?? 0;
    const priorAverage = priorCounts.length > 0 ? average(priorCounts) : 0;
    const recent = values.filter(record => Date.parse(record.occurredAt) >= now.getTime() - DAY_MS);
    const duplicateCount = maximumInWindow(recent.map(record => Date.parse(record.occurredAt)), TEN_MINUTES_MS);
    const duplicateAlert = duplicateCount >= 20 ? { count: duplicateCount, windowMinutes: 10 as const } : null;

    const canDetectDeviation = phase !== 'learning';
    const newApp = canDetectDeviation && Boolean(latest.sourceApp) && !priorApps.has(latest.sourceApp!);
    const newDestination = canDetectDeviation && !hasPriorDestination;
    const priorFunctions = priorFunctionsByApp.get(latest.sourceApp ?? 'unknown');
    const purposeMismatch = canDetectDeviation && Boolean(priorFunctions?.size)
      && !priorFunctions!.has(intelligence.commercialFunction);
    const frequencySpike = canDetectDeviation && priorAverage > 0
      && todayFrequency >= Math.max(10, Math.ceil(priorAverage * 3));
    const deviationReason = newApp
      ? `${appName} was first observed communicating today. KICK’S cannot determine whether it was newly installed.`
      : newDestination
        ? `${appName} contacted ${intelligence.company}, a destination not seen during its seven-day baseline.`
        : purposeMismatch
          ? `${appName} used ${functionLabel(intelligence.commercialFunction)} services not present in its recent purpose mix.`
          : frequencySpike
            ? `${appName} made ${todayFrequency} communications today; its recent daily average was ${Math.round(priorAverage)}.`
            : null;
    const baselineDelta: ObservationBaseline['baselineDelta'] = phase === 'learning'
      ? 'learning'
      : newApp
        ? 'first_observed_app'
        : newDestination
          ? 'new_destination'
          : purposeMismatch
            ? 'new_purpose'
            : frequencySpike
              ? 'frequency_spike'
              : intelligence.commercialFunction === 'unknown'
                ? 'unknown'
                : 'normal';
    const deviationSeverity = deviationReason ? severityFor(intelligence.commercialFunction) : null;
    const behaviorTier = tierFor(latest.sourceApp, intelligence.commercialFunction, Boolean(deviationReason));
    const baselineStatus: BaselineStatus = phase === 'learning'
      ? 'learning'
      : behaviorTier === 'unknown'
        ? 'unknown'
        : deviationReason
          ? 'deviation'
          : 'expected';
    const commercialIntentScore = intentScore(intelligence.commercialFunction, intelligence.confidence, todayFrequency || values.length);
    const valuePotential = valuePotentialFor(intelligence.commercialFunction, commercialIntentScore);
    const buyerCategory = buyerCategoryFor(intelligence.commercialFunction);
    const context: ObservationBaseline = {
      behaviorTier, baselineStatus, baselineConfidence: confidence,
      expectedFrequencyMin, expectedFrequencyMax, deviationSeverity, deviationReason, baselineDelta,
      firstSeenAt: values[0]!.occurredAt,
      duplicateAlert,
      signatureId: signatureId(latest.sourceApp, latest.destinationHost, intelligence.commercialFunction, intelligence.registryVersion),
      commercialIntentScore, valuePotential, buyerCategory,
      evidenceNeeded: behaviorTier === 'unknown'
        ? 'Verified app ownership or a reviewed Domain Intelligence Registry match.'
        : null,
      whyThisMatters: whyThisMatters(behaviorTier, deviationReason, valuePotential),
      whyTags: tagsFor(behaviorTier, valuePotential),
    };
    byGroup.set(key, context);

    if (deviationReason && deviationSeverity) deviations.push({
      id: `${key}:deviation`, severity: deviationSeverity,
      title: deviationTitle(newApp, newDestination, purposeMismatch),
      explanation: `${deviationReason} Unexpected does not automatically mean unsafe.`,
      appName, observedAt: latest.occurredAt,
    });
    if (duplicateAlert) deviations.push({
      id: `${key}:duplicate`, severity: behaviorTier === 'behavioral' || behaviorTier === 'unexpected' ? 'medium' : 'notice',
      title: 'Repeated communication pattern',
      explanation: `${appName} contacted ${intelligence.company} ${duplicateAlert.count} times within 10 minutes. Repetition alone does not mean the activity was unsafe.`,
      appName, observedAt: latest.occurredAt,
    });
  }

  deviations.sort((left, right) => severityRank(right.severity) - severityRank(left.severity)
    || Date.parse(right.observedAt) - Date.parse(left.observedAt));
  return { stability, deviations: deviations.slice(0, 5), byGroup };
}

export function buildWeeklyDigest(
  records: BaselineRecord[],
  analysis: BaselineAnalysis,
  opportunitySummary: { matches: number; estimatedValueCents: number | null },
  now = new Date(),
): WeeklyDigest {
  const weekDays = lastUtcDays(now, 7);
  const weekStart = weekDays[0]!;
  const weekEnd = weekDays.at(-1)!;
  const weekly = records.filter(record => {
    const day = utcDayKey(new Date(record.occurredAt));
    return day >= weekStart && day <= weekEnd;
  });
  const tierCounts: Record<BehaviorTier, number> = { operational: 0, behavioral: 0, unexpected: 0, unknown: 0 };
  const appCounts = new Map<string, number>();
  const appPackages = new Set<string>();
  const groups = new Map<string, BaselineRecord[]>();
  for (const record of weekly) {
    const key = baselineGroupKey(record.sourceApp, record.destinationHost);
    const tier = analysis.byGroup.get(key)?.behaviorTier ?? 'unknown';
    tierCounts[tier] += 1;
    groups.set(key, [...(groups.get(key) ?? []), record]);
    if (record.sourceApp) {
      appPackages.add(record.sourceApp);
      const appName = record.sourceAppName ?? 'Identified app';
      appCounts.set(appName, (appCounts.get(appName) ?? 0) + 1);
    }
  }
  const newDestinations = [...groups.entries()]
    .map(([key, values]) => {
      const context = analysis.byGroup.get(key);
      const latest = values.at(-1)!;
      if (!context || context.baselineStatus !== 'deviation') return null;
      return {
        company: enrichDomain(latest.destinationHost).company,
        domain: latest.destinationHost,
        firstSeenAt: context.firstSeenAt,
        tier: context.behaviorTier,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt));
  const potentialValueGroups = [...groups.keys()].filter(key => {
    const context = analysis.byGroup.get(key);
    return context && context.valuePotential !== 'not_assessed';
  });
  return {
    scope: 'current_device', weekStart, weekEnd,
    observedDays: new Set(weekly.map(record => utcDayKey(new Date(record.occurredAt)))).size,
    totalApps: appPackages.size,
    totalDomains: new Set(weekly.map(record => record.destinationHost)).size,
    totalObservations: weekly.length,
    operationalCount: tierCounts.operational,
    behavioralCount: tierCounts.behavioral,
    unexpectedCount: tierCounts.unexpected,
    unknownCount: tierCounts.unknown,
    newTrackers: newDestinations.filter(item => {
      const context = analysis.byGroup.get(baselineGroupKey(
        weekly.find(record => record.destinationHost === item.domain)?.sourceApp ?? null,
        item.domain,
      ));
      return context?.valuePotential !== 'not_assessed';
    }).length,
    potentialValuePatterns: potentialValueGroups.length,
    eligibleOpportunities: opportunitySummary.matches,
    estimatedWeeklyValueCents: opportunitySummary.estimatedValueCents,
    valueEstimateStatus: opportunitySummary.estimatedValueCents == null ? 'buyer_pricing_not_validated' : 'matched_buyer_pricing',
    topAppsByActivity: [...appCounts.entries()]
      .map(([app, communications]) => ({ app, communications }))
      .sort((left, right) => right.communications - left.communications)
      .slice(0, 5),
    newDestinations: newDestinations.slice(0, 10),
    generatedAt: now.toISOString(),
  };
}

function baselinePhase(observedDays: number): BaselinePhase {
  if (observedDays < 7) return 'learning';
  if (observedDays < 30) return 'maturing';
  return 'stable';
}

function baselineConfidence(observedDays: number) {
  if (observedDays <= 0) return 0;
  if (observedDays < 7) return Math.round((observedDays / 7) * 60);
  if (observedDays < 30) return Math.round(60 + ((observedDays - 7) / 23) * 30);
  return 95;
}

function baselinePhaseForVerifiedTime(verifiedMs: number, observedDays: number): BaselinePhase {
  if (verifiedMs < TARGET_BASELINE_MS) return 'learning';
  return observedDays < 30 ? 'maturing' : 'stable';
}

function baselineConfidenceForVerifiedTime(verifiedMs: number, observedDays: number) {
  if (verifiedMs < TARGET_BASELINE_MS) {
    return Math.round(Math.min(1, verifiedMs / TARGET_BASELINE_MS) * 60);
  }
  return baselineConfidence(Math.max(7, observedDays));
}

function stabilityStatus(observedDays: number, changePercent: number | null): StabilitySummary['status'] {
  if (observedDays === 0) return 'waiting';
  if (observedDays < 7 || changePercent == null) return 'learning';
  if (changePercent > 25) return 'above_range';
  if (changePercent < -25) return 'below_range';
  return 'within_range';
}

function stabilitySummary(
  completedDays: number,
  dailyAverage: number | null,
  todayCount: number,
  changePercent: number | null,
  continuity: BaselineContinuity | null,
  verifiedMs: number,
) {
  if (!continuity?.segmentStartedAt) return completedDays === 0
    ? 'Waiting for minimized observations to begin the seven-day baseline.'
    : completedDays < 7 || dailyAverage == null || changePercent == null
      ? `Day ${completedDays} of 7. KICK’S is learning your device pattern before calling behavior unusual.`
      : stableComparison(dailyAverage, todayCount, changePercent);
  if (completedDays === 0 && !continuity.verifiedThroughAt) {
    return 'Waiting for the collector to verify the first active learning period.';
  }
  if (completedDays < 7 || dailyAverage == null || changePercent == null) {
    const verifiedHours = Math.floor(verifiedMs / HOUR_MS);
    const remainingHours = Math.max(0, Math.ceil((TARGET_BASELINE_MS - verifiedMs) / HOUR_MS));
    const state = !continuity.isActive
      ? ' The learning clock is paused and will continue when monitoring resumes.'
      : continuity.resumeCount > 0 && continuity.lastInterruption
        ? ` Collection resumed after a recorded ${interruptionLabel(continuity.lastInterruption.kind)}; previously verified time remains credited.`
        : '';
    return `${verifiedHours} of ${TARGET_BASELINE_HOURS} active collection hours verified. ${remainingHours} hours remain before KICK’S establishes the baseline.${state}`;
  }
  return stableComparison(dailyAverage, todayCount, changePercent);
}

function stableComparison(dailyAverage: number, todayCount: number, changePercent: number) {
  const direction = changePercent > 0 ? 'above' : changePercent < 0 ? 'below' : 'equal to';
  return `Your device normally sends about ${Math.round(dailyAverage)} communications per observed day. Today is ${Math.abs(changePercent)}% ${direction} that pattern at ${todayCount}.`;
}

function interruptionLabel(kind: BaselineInterruptionKind) {
  if (kind === 'crash') return 'collector crash';
  if (kind === 'revoked') return 'VPN permission interruption';
  if (kind === 'capacity') return 'local safety stop';
  return 'monitoring stop';
}

function tierFor(sourceApp: string | null, commercialFunction: CommercialFunction, deviation: boolean): BehaviorTier {
  if (deviation) return 'unexpected';
  if (!sourceApp || commercialFunction === 'unknown') return 'unknown';
  if (['infrastructure', 'content_delivery', 'security'].includes(commercialFunction)) return 'operational';
  return 'behavioral';
}

function severityFor(commercialFunction: CommercialFunction): DeviationSeverity {
  if (commercialFunction === 'identity' || commercialFunction === 'location') return 'high';
  if (commercialFunction === 'advertising' || commercialFunction === 'analytics') return 'medium';
  return 'notice';
}

function intentScore(commercialFunction: CommercialFunction, domainConfidence: number, frequency: number) {
  const base: Record<CommercialFunction, number> = {
    advertising: 84, analytics: 68, identity: 88, location: 90,
    infrastructure: 8, content_delivery: 6, security: 5, unknown: 0,
  };
  if (['infrastructure', 'content_delivery', 'security', 'unknown'].includes(commercialFunction)) return 0;
  const frequencySignal = Math.min(10, Math.round(Math.log2(Math.max(1, frequency)) * 2));
  return Math.min(99, Math.round(base[commercialFunction] * .7 + domainConfidence * .2 + frequencySignal));
}

function valuePotentialFor(commercialFunction: CommercialFunction, score: number): ValuePotential {
  if (['infrastructure', 'content_delivery', 'security', 'unknown'].includes(commercialFunction)) return 'not_assessed';
  if (score >= 85) return 'high';
  if (score >= 70) return 'moderate';
  return 'emerging';
}

function buyerCategoryFor(commercialFunction: CommercialFunction) {
  const categories: Record<CommercialFunction, string | null> = {
    advertising: 'Advertising measurement', analytics: 'Audience and product analytics',
    identity: 'Identity services', location: 'Mobility and location intelligence',
    infrastructure: null, content_delivery: null, security: null, unknown: null,
  };
  return categories[commercialFunction];
}

function whyThisMatters(tier: BehaviorTier, reason: string | null, value: ValuePotential) {
  if (tier === 'unexpected') return reason ?? 'This pattern changed from the established baseline and deserves context, not panic.';
  if (tier === 'unknown') return 'KICK’S needs more verified evidence before explaining this communication.';
  if (tier === 'operational') return 'This supports routine app operation and is shown as context rather than an alert.';
  return `This behavioral activity has ${value.replace('_', ' ')} potential commercial relevance. Separate sharing consent is still required.`;
}

function tagsFor(tier: BehaviorTier, value: ValuePotential) {
  if (tier === 'unexpected') return ['Behavior change', 'Privacy'];
  if (tier === 'unknown') return ['Needs evidence'];
  if (tier === 'operational') return ['Stability'];
  return value === 'not_assessed' ? ['Privacy'] : ['Privacy', 'Potential value'];
}

function deviationTitle(newApp: boolean, newDestination: boolean, purposeMismatch: boolean) {
  if (newApp) return 'First observed app activity';
  if (newDestination) return 'New destination pattern';
  if (purposeMismatch) return 'New purpose pattern';
  return 'Communication frequency changed';
}

function functionLabel(value: CommercialFunction) {
  return value === 'unknown' ? 'unclassified' : value.replace(/_/g, ' ');
}

function signatureId(sourceApp: string | null, host: string, commercialFunction: CommercialFunction, registryVersion: string) {
  const hash = createHash('sha256').update(`${sourceApp ?? 'unknown'}|${host}|${commercialFunction}|${registryVersion}`).digest('hex');
  return `${['infrastructure', 'content_delivery', 'security'].includes(commercialFunction) ? 'ops' : 'sig'}_${hash.slice(0, 12)}`;
}

function maximumInWindow(timestamps: number[], windowMs: number) {
  if (timestamps.length === 0) return 0;
  const ordered = timestamps.filter(Number.isFinite).sort((left, right) => left - right);
  let left = 0;
  let maximum = 0;
  for (let right = 0; right < ordered.length; right += 1) {
    while (ordered[right]! - ordered[left]! > windowMs) left += 1;
    maximum = Math.max(maximum, right - left + 1);
  }
  return maximum;
}

function groupRecords(records: BaselineRecord[]) {
  const grouped = new Map<string, BaselineRecord[]>();
  for (const record of records) {
    const key = baselineGroupKey(record.sourceApp, record.destinationHost);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return grouped;
}

function countBy<T>(values: T[], keyFor: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function utcDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function lastUtcDays(now: Date, count: number) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, index) => new Date(start - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10));
}

function weekdayLabel(day: string) {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function severityRank(value: DeviationSeverity) {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}
