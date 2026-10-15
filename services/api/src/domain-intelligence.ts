import { createHash } from 'node:crypto';

export type CommercialFunction =
  | 'advertising'
  | 'analytics'
  | 'identity'
  | 'location'
  | 'infrastructure'
  | 'content_delivery'
  | 'security'
  | 'unknown';

export type DomainEvidence = {
  type: 'curated_rule' | 'dns' | 'whois' | 'asn' | 'public_record' | 'corporate_record' | 'historical_observation' | 'manual_review';
  detail: string;
  recordedAt: string;
  sourceReference?: string;
  sourceAuthority?: string;
  expiresAt?: string;
};

export type CorporateParentVerificationStatus = 'unverified' | 'corroborated' | 'verified' | 'disputed';

export type DomainIntelligence = {
  registryId: string | null;
  matchedDomain: string | null;
  company: string;
  parentCompany: string;
  corporateParentLegalName: string | null;
  corporateParentVerificationStatus: CorporateParentVerificationStatus;
  corporateParentVerifiedAt: string | null;
  ownershipConfidence: number;
  functionConfidence: number;
  commercialFunction: CommercialFunction;
  subcategory: string;
  purpose: string;
  dataCategory: string;
  confidence: number;
  evidence: string;
  evidenceSources: DomainEvidence[];
  typicality: string;
  classificationSource: 'auto' | 'manual' | 'verified';
  reviewStatus: 'auto_classified' | 'manually_reviewed' | 'disputed';
  recordStatus: 'active' | 'deprecated';
  firstSeen: string;
  lastUpdated: string;
  registryVersion: string;
};

type RegistryRule = {
  suffixes: string[];
  company: string;
  commercialFunction: CommercialFunction;
  purpose: string;
  dataCategory: string;
  confidence: number;
  evidence: string;
  typicality: string;
  subcategory?: string;
};

export const DOMAIN_REGISTRY_VERSION = 'registry-2026-08-20';
const REGISTRY_EFFECTIVE_AT = '2026-08-20T00:00:00.000Z';
const intelligenceCache = new Map<string, DomainIntelligence>();
const MAX_CACHE_ENTRIES = 2048;

const rules: RegistryRule[] = [
  {
    suffixes: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com'],
    company: 'Google', commercialFunction: 'advertising', purpose: 'Advertising delivery and measurement',
    subcategory: 'ad server and exchange',
    dataCategory: 'App interaction and device signals (inferred; contents not observed)', confidence: 95,
    evidence: 'Matched a recognized Google advertising-service domain.',
    typicality: 'Advertising services are common in ad-supported apps; this app’s baseline is still being learned.',
  },
  {
    suffixes: ['google-analytics.com', 'app-measurement.com'],
    company: 'Google Analytics', commercialFunction: 'analytics', purpose: 'App usage analytics',
    subcategory: 'usage measurement',
    dataCategory: 'Usage and device diagnostics (inferred; contents not observed)', confidence: 94,
    evidence: 'Matched a recognized Google Analytics measurement domain.',
    typicality: 'Analytics services are common across many app categories; this app’s baseline is still being learned.',
  },
  {
    suffixes: ['crashlytics.com'],
    company: 'Google Firebase', commercialFunction: 'analytics', purpose: 'Crash and performance analytics',
    subcategory: 'crash reporting',
    dataCategory: 'Crash and device diagnostics (inferred; contents not observed)', confidence: 94,
    evidence: 'Matched the Firebase Crashlytics service domain.',
    typicality: 'Crash reporting is common app-support infrastructure.',
  },
  {
    suffixes: ['mtalk.google.com'],
    company: 'Google', commercialFunction: 'infrastructure', purpose: 'Android push-notification delivery',
    subcategory: 'push delivery',
    dataCategory: 'Connection and notification-delivery metadata only', confidence: 97,
    evidence: 'Matched Google’s Android messaging transport domain.',
    typicality: 'This is common infrastructure for Android apps that receive push notifications.',
  },
  {
    suffixes: ['safebrowsing.googleapis.com'],
    company: 'Google', commercialFunction: 'security', purpose: 'Malicious-site and download protection',
    subcategory: 'safe browsing',
    dataCategory: 'Security lookup metadata; page contents are not observed', confidence: 91,
    evidence: 'Matched Google’s Safe Browsing service subdomain.',
    typicality: 'Security lookups are common protective traffic on Android devices.',
  },
  {
    suffixes: ['gstatic.com', 'googleusercontent.com'],
    company: 'Google', commercialFunction: 'content_delivery', purpose: 'Google-hosted content delivery',
    subcategory: 'content delivery network',
    dataCategory: 'Connection metadata; delivered content is not visible', confidence: 82,
    evidence: 'Matched a Google-operated content delivery domain.',
    typicality: 'Content delivery is common operational traffic across Android apps.',
  },
  {
    suffixes: ['googleapis.com'],
    company: 'Google', commercialFunction: 'infrastructure', purpose: 'Google-hosted app services',
    dataCategory: 'Connection metadata; the exact service data is not visible', confidence: 76,
    evidence: 'Matched a broad Google service domain; exact use varies by subdomain.',
    typicality: 'Google-hosted infrastructure is common across Android apps.',
  },
  {
    suffixes: ['events.data.microsoft.com'],
    company: 'Microsoft', commercialFunction: 'analytics', purpose: 'Diagnostics and usage analytics',
    dataCategory: 'Usage and device diagnostics (inferred; contents not observed)', confidence: 94,
    evidence: 'Matched Microsoft’s diagnostic event service domain.',
    typicality: 'Diagnostics are common in Microsoft-connected apps; this app’s baseline is still being learned.',
  },
  {
    suffixes: ['signalr.net'],
    company: 'Microsoft Azure', commercialFunction: 'infrastructure', purpose: 'Real-time app messaging infrastructure',
    dataCategory: 'Connection and service-delivery metadata only', confidence: 96,
    evidence: 'Matched the Microsoft Azure SignalR service domain.',
    typicality: 'Real-time relay traffic is common for apps with live updates or messaging.',
  },
  {
    suffixes: ['azureedge.net'],
    company: 'Microsoft Azure', commercialFunction: 'content_delivery', purpose: 'Microsoft-hosted content delivery',
    subcategory: 'content delivery network',
    dataCategory: 'Connection metadata; delivered content is not visible', confidence: 91,
    evidence: 'Matched a Microsoft Azure content delivery domain.',
    typicality: 'Content delivery is common operational traffic for Microsoft-connected apps.',
  },
  {
    suffixes: ['skype.com', 'windows.com'],
    company: 'Microsoft', commercialFunction: 'infrastructure', purpose: 'Microsoft-hosted app services',
    dataCategory: 'Connection metadata; the exact service data is not visible', confidence: 79,
    evidence: 'Matched a Microsoft-owned service domain; exact use depends on the subdomain.',
    typicality: 'Microsoft-hosted infrastructure is common in Microsoft-connected apps.',
  },
  {
    suffixes: ['appsflyer.com', 'adjust.com', 'branch.io', 'kochava.com'],
    company: 'Mobile measurement provider', commercialFunction: 'advertising', purpose: 'Advertising attribution and measurement',
    dataCategory: 'Install and app-interaction signals (inferred; contents not observed)', confidence: 92,
    evidence: 'Matched a recognized mobile attribution provider domain.',
    typicality: 'Mobile attribution is common in apps that measure campaigns; this app’s baseline is still being learned.',
  },
  {
    suffixes: ['amplitude.com', 'mixpanel.com', 'segment.io'],
    company: 'Product analytics provider', commercialFunction: 'analytics', purpose: 'Product usage analytics',
    dataCategory: 'App interaction signals (inferred; contents not observed)', confidence: 92,
    evidence: 'Matched a recognized product analytics provider domain.',
    typicality: 'Product analytics are common across many app categories; this app’s baseline is still being learned.',
  },
  {
    suffixes: ['onesignal.com'],
    company: 'OneSignal', commercialFunction: 'infrastructure', purpose: 'Push-notification delivery',
    dataCategory: 'Connection and notification-delivery metadata only', confidence: 95,
    evidence: 'Matched the OneSignal push-notification service domain.',
    typicality: 'Push delivery is common infrastructure for apps that send notifications.',
  },
  {
    suffixes: ['sentry.io'],
    company: 'Sentry', commercialFunction: 'analytics', purpose: 'Crash and performance monitoring',
    dataCategory: 'Crash and device diagnostics (inferred; contents not observed)', confidence: 93,
    evidence: 'Matched the Sentry monitoring service domain.',
    typicality: 'Crash monitoring is common app-support infrastructure.',
  },
  {
    suffixes: ['analytics.tiktok.com', 'business-api.tiktok.com'],
    company: 'TikTok', commercialFunction: 'advertising', purpose: 'Advertising and campaign measurement',
    dataCategory: 'App interaction and campaign signals (inferred; contents not observed)', confidence: 93,
    evidence: 'Matched a TikTok advertising or analytics subdomain.',
    typicality: 'Campaign measurement may be expected in ad-supported apps; this app’s baseline is still being learned.',
  },
  {
    suffixes: ['tiktokcdn.com'],
    company: 'TikTok', commercialFunction: 'content_delivery', purpose: 'TikTok content delivery',
    subcategory: 'content delivery network',
    dataCategory: 'Connection metadata; delivered media is not observed', confidence: 91,
    evidence: 'Matched a TikTok-operated content delivery domain.',
    typicality: 'Content delivery is expected while TikTok media services are in use.',
  },
  {
    suffixes: ['tiktokv.com', 'musical.ly'],
    company: 'TikTok', commercialFunction: 'infrastructure', purpose: 'TikTok-hosted app or content services',
    dataCategory: 'Connection metadata; content and payloads are not observed', confidence: 86,
    evidence: 'Matched a TikTok-operated service domain.',
    typicality: 'This can be expected when TikTok services are in use; the exact purpose depends on the subdomain.',
  },
  {
    suffixes: ['scdn.co'],
    company: 'Spotify', commercialFunction: 'content_delivery', purpose: 'Spotify content delivery',
    subcategory: 'content delivery network',
    dataCategory: 'Connection metadata; listening contents are not observed', confidence: 91,
    evidence: 'Matched a Spotify-operated content delivery domain.',
    typicality: 'Content delivery is expected while Spotify services are in use.',
  },
  {
    suffixes: ['spotify.com'],
    company: 'Spotify', commercialFunction: 'infrastructure', purpose: 'Spotify app and content services',
    dataCategory: 'Connection metadata; listening contents are not observed', confidence: 88,
    evidence: 'Matched a Spotify-operated service domain.',
    typicality: 'This can be expected while Spotify services are in use.',
  },
];

export function enrichDomain(destinationHost: string): DomainIntelligence {
  const host = destinationHost.toLowerCase().replace(/\.$/, '');
  const cached = intelligenceCache.get(host);
  if (cached) return cached;
  const match = rules.find(rule => rule.suffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`)));
  const intelligence: DomainIntelligence = !match ? {
    registryId: null, matchedDomain: null,
    company: 'Unverified destination', parentCompany: 'Unverified destination',
    corporateParentLegalName: null, corporateParentVerificationStatus: 'unverified',
    corporateParentVerifiedAt: null, ownershipConfidence: 0, functionConfidence: 30,
    commercialFunction: 'unknown', subcategory: 'unclassified', purpose: 'Purpose not yet determined',
    dataCategory: 'Connection metadata only; no contents were inspected', confidence: 30,
    evidence: 'No matching Domain Intelligence Registry rule.',
    evidenceSources: [], classificationSource: 'auto', reviewStatus: 'auto_classified', recordStatus: 'active',
    firstSeen: REGISTRY_EFFECTIVE_AT, lastUpdated: REGISTRY_EFFECTIVE_AT,
    typicality: 'Not enough verified evidence to compare this pattern yet.',
    registryVersion: DOMAIN_REGISTRY_VERSION,
  } : toIntelligence(match, host);
  if (intelligenceCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = intelligenceCache.keys().next().value as string | undefined;
    if (oldest) intelligenceCache.delete(oldest);
  }
  intelligenceCache.set(host, intelligence);
  return intelligence;
}

function toIntelligence(rule: RegistryRule, host: string): DomainIntelligence {
  const matchedDomain = rule.suffixes.find(suffix => host === suffix || host.endsWith(`.${suffix}`))!;
  return {
    registryId: registryId(matchedDomain),
    matchedDomain,
    company: rule.company,
    parentCompany: rule.company,
    corporateParentLegalName: null,
    corporateParentVerificationStatus: 'unverified',
    corporateParentVerifiedAt: null,
    ownershipConfidence: 25,
    functionConfidence: rule.confidence,
    commercialFunction: rule.commercialFunction,
    subcategory: rule.subcategory ?? defaultSubcategory(rule.commercialFunction),
    purpose: rule.purpose,
    dataCategory: rule.dataCategory,
    confidence: rule.confidence,
    evidence: rule.evidence,
    evidenceSources: [{ type: 'curated_rule', detail: rule.evidence, recordedAt: REGISTRY_EFFECTIVE_AT }],
    typicality: rule.typicality,
    classificationSource: 'auto',
    reviewStatus: 'auto_classified',
    recordStatus: 'active',
    firstSeen: REGISTRY_EFFECTIVE_AT,
    lastUpdated: REGISTRY_EFFECTIVE_AT,
    registryVersion: DOMAIN_REGISTRY_VERSION,
  };
}

const ownershipEvidenceWeights: Record<DomainEvidence['type'], number> = {
  curated_rule: 0,
  dns: 10,
  whois: 20,
  asn: 8,
  public_record: 20,
  corporate_record: 45,
  historical_observation: 5,
  manual_review: 15,
};

export function ownershipEvidenceWeight(type: DomainEvidence['type']) {
  return ownershipEvidenceWeights[type];
}

export function evaluateCorporateParentEvidence(
  evidence: DomainEvidence[],
  now = new Date(),
): { status: CorporateParentVerificationStatus; confidence: number; independentSources: number } {
  const active = evidence.filter(item => !item.expiresAt || Date.parse(item.expiresAt) >= now.getTime());
  const types = new Set(active.map(item => item.type).filter(type => type !== 'curated_rule'));
  const authorities = new Set(active.map(item => item.sourceAuthority ?? item.sourceReference ?? item.type));
  const confidence = Math.min(100, [...types].reduce((total, type) => total + ownershipEvidenceWeights[type], 0));
  const disputed = active.some(item => item.type === 'manual_review' && /disput|conflict|incorrect/i.test(item.detail));
  if (disputed) return { status: 'disputed', confidence: Math.min(confidence, 49), independentSources: authorities.size };
  const hasPrimaryOwnershipEvidence = types.has('corporate_record') || types.has('whois');
  if (confidence >= 70 && authorities.size >= 2 && hasPrimaryOwnershipEvidence) {
    return { status: 'verified', confidence, independentSources: authorities.size };
  }
  if (confidence >= 45 && authorities.size >= 2) {
    return { status: 'corroborated', confidence, independentSources: authorities.size };
  }
  return { status: 'unverified', confidence, independentSources: authorities.size };
}

function registryId(domain: string) {
  const hex = createHash('sha256').update(`kicks-domain-registry:${domain}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function defaultSubcategory(value: CommercialFunction) {
  const labels: Record<CommercialFunction, string> = {
    advertising: 'advertising service',
    analytics: 'analytics service',
    identity: 'identity service',
    location: 'location service',
    infrastructure: 'hosted infrastructure',
    content_delivery: 'content delivery network',
    security: 'security service',
    unknown: 'unclassified',
  };
  return labels[value];
}

export function attributionConfidence(attribution: 'verified' | 'best_effort' | 'unknown') {
  if (attribution === 'verified') return 98;
  if (attribution === 'best_effort') return 72;
  return 0;
}

export function combinedConfidence(attribution: 'verified' | 'best_effort' | 'unknown', domainConfidence: number) {
  const appConfidence = attributionConfidence(attribution);
  if (appConfidence === 0) return Math.round(domainConfidence * 0.45);
  return Math.round(appConfidence * 0.55 + domainConfidence * 0.45);
}
