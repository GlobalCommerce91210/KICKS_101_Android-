import { createHash } from 'node:crypto';

export type EndpointRole = 'analytics' | 'advertising' | 'identity' | 'location' | 'infrastructure';
export type EndpointEvidenceSource = 'verified_public_contract' | 'first_party_instrumentation' | 'plaintext_http_on_device';

export type EndpointIntelligence = {
  signatureId: string;
  hostSuffix: string;
  method: 'GET' | 'POST';
  patternTemplate: string;
  role: EndpointRole;
  purpose: string;
  confidence: number;
  evidenceSource: EndpointEvidenceSource;
  registryVersion: string;
};

type EndpointRule = EndpointIntelligence & { path: RegExp };

export const ENDPOINT_REGISTRY_VERSION = 'endpoint-registry-2026-09-01';

const stableUuid = (value: string) => {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const rule = (input: Omit<EndpointIntelligence, 'signatureId' | 'registryVersion'> & { path: RegExp }): EndpointRule => ({
  ...input,
  signatureId: stableUuid(`kicks-endpoint:${input.hostSuffix}:${input.method}:${input.patternTemplate}`),
  registryVersion: ENDPOINT_REGISTRY_VERSION,
});

const rules: EndpointRule[] = [
  rule({
    hostSuffix: 'staging-api.datastorminc.live', method: 'POST',
    patternTemplate: '/v1/metadata-batches', path: /^\/v1\/metadata-batches$/,
    role: 'infrastructure', purpose: 'Consent-linked minimized metadata ingestion', confidence: 100,
    evidenceSource: 'first_party_instrumentation',
  }),
  rule({
    hostSuffix: 'staging-api.datastorminc.live', method: 'POST',
    patternTemplate: '/v1/collection-events', path: /^\/v1\/collection-events$/,
    role: 'infrastructure', purpose: 'Collector continuity and health evidence', confidence: 100,
    evidenceSource: 'first_party_instrumentation',
  }),
  rule({
    hostSuffix: 'staging-api.datastorminc.live', method: 'POST',
    patternTemplate: '/v1/consent-events', path: /^\/v1\/consent-events$/,
    role: 'infrastructure', purpose: 'Consumer permission decision recording', confidence: 100,
    evidenceSource: 'first_party_instrumentation',
  }),
];

const publicRule = ({ path: _path, ...value }: EndpointRule): EndpointIntelligence => value;

export function endpointBySignatureId(signatureId: string): EndpointIntelligence | null {
  const match = rules.find(candidate => candidate.signatureId === signatureId);
  return match ? publicRule(match) : null;
}

export function classifyReviewedEndpoint(host: string, path: string, method: string): EndpointIntelligence | null {
  if (path.includes('?') || path.includes('#') || path.length > 256) return null;
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  const normalizedMethod = method.toUpperCase();
  const match = rules.find(candidate =>
    (normalizedHost === candidate.hostSuffix || normalizedHost.endsWith(`.${candidate.hostSuffix}`))
    && normalizedMethod === candidate.method
    && candidate.path.test(path));
  return match ? publicRule(match) : null;
}

export function endpointRegistryEntries(): EndpointIntelligence[] {
  return rules.map(publicRule);
}
