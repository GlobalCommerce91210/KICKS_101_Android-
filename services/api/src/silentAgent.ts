export type PilotAgent =
  | 'observability-quality'
  | 'consent-guardian'
  | 'api-service-watcher'
  | 'reconciliation';
export type FindingStatus = 'fact' | 'inference' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type MobilePlatform = 'android' | 'ios';

export interface ReportWindow {
  start: string;
  end: string;
}

export interface PilotEvidence {
  id: string;
  source: 'android_diagnostics' | 'ios_diagnostics' | 'api_health';
  observedAt: string;
  window: ReportWindow;
  platform?: MobilePlatform;
  health?: 'healthy' | 'unhealthy';
  eventIds?: string[];
  iosCollectorProof?: {
    signedNetworkExtension: boolean;
    signatureValid: boolean;
    physicalDeviceValidated: boolean;
  };
}

export interface CountEvidence {
  id: string;
  source: 'device' | 'api' | 'audit' | 'database';
  count: number;
  definition: string;
  window: ReportWindow;
  observedAt: string;
}

export interface RevocationEvidence {
  id: string;
  observedAt: string;
  window: ReportWindow;
  revocation: 'revoked' | 'unknown';
  downstream: 'blocked' | 'processing' | 'unknown';
}

export interface PilotEvidenceBundle {
  runId: string;
  generatedAt: string;
  window: ReportWindow;
  freshnessMs: number;
  evidence: PilotEvidence[];
  counts?: CountEvidence[];
  revocations?: RevocationEvidence[];
  sourceFailures?: PilotSourceFailure[];
}

export interface PilotFinding {
  agent: PilotAgent;
  status: FindingStatus;
  confidence: Confidence;
  summary: string;
  evidenceRefs: string[];
  sourceTimestamps: string[];
  window: ReportWindow;
  recommendation: string;
}

export interface PilotSourceFailure {
  source: PilotEvidence['source'] | CountEvidence['source'] | 'consent_audit';
  observedAt: string;
}

export interface PilotReport {
  runId: string;
  generatedAt: string;
  window: ReportWindow;
  rulesVersion: 'kick-013-v1';
  limitations: string[];
  failures: PilotSourceFailure[];
  platforms: Record<MobilePlatform, PilotFinding[]>;
  api: PilotFinding[];
  consent: PilotFinding[];
  reconciliation: PilotFinding[];
}

const safeRef = (value: string): string =>
  /^evidence:[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : '[REDACTED]';
const safeRunId = (value: string): string =>
  /^run:[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : '[REDACTED]';
const safeTimestamp = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : 'unknown';
};

const fresh = (observedAt: string, generatedAt: string, freshnessMs: number): boolean => {
  const observed = Date.parse(observedAt);
  const generated = Date.parse(generatedAt);
  return Number.isFinite(freshnessMs) && freshnessMs >= 0 &&
    Number.isFinite(observed) && Number.isFinite(generated) &&
    observed <= generated && generated - observed <= freshnessMs;
};

const sameWindow = (left: ReportWindow, right: ReportWindow): boolean => {
  const leftStart = Date.parse(left.start);
  const leftEnd = Date.parse(left.end);
  const rightStart = Date.parse(right.start);
  const rightEnd = Date.parse(right.end);
  return Number.isFinite(leftStart) && Number.isFinite(leftEnd) &&
    Number.isFinite(rightStart) && Number.isFinite(rightEnd) &&
    leftStart <= leftEnd && rightStart <= rightEnd &&
    left.start === right.start && left.end === right.end;
};

const finding = (
  agent: PilotAgent,
  status: FindingStatus,
  confidence: Confidence,
  summary: string,
  evidenceRefs: string[],
  window: ReportWindow,
  recommendation: string,
  sourceTimestamps: string[] = []
): PilotFinding => ({
  agent,
  status,
  confidence,
  summary,
  evidenceRefs: [...new Set(evidenceRefs.map(safeRef))],
  sourceTimestamps: [...new Set(sourceTimestamps.map(safeTimestamp))],
  window: { start: safeTimestamp(window.start), end: safeTimestamp(window.end) },
  recommendation
});

export function buildPilotReport(bundle: PilotEvidenceBundle): PilotReport {
  const window = {
    start: safeTimestamp(bundle.window.start),
    end: safeTimestamp(bundle.window.end)
  };
  const usable = bundle.evidence.filter(item =>
    fresh(item.observedAt, bundle.generatedAt, bundle.freshnessMs) &&
    sameWindow(item.window, bundle.window)
  );

  const platforms = (['android', 'ios'] as const).reduce((result, platform) => {
    const source = platform === 'android' ? 'android_diagnostics' : 'ios_diagnostics';
    const allRecords = bundle.evidence.filter(item => item.source === source && item.platform === platform);
    const records = usable.filter(item => item.source === source && item.platform === platform);
    const latest = records
      .filter(item => item.health !== undefined)
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
    const healthFinding = latest
      ? finding(
        'observability-quality',
        'fact',
        'high',
        `${platform.toUpperCase()} diagnostic source reports ${latest.health}.`,
        [latest.id],
        window,
        'Review this observation; no action was performed.',
        [latest.observedAt]
      )
      : finding(
        'observability-quality',
        'unknown',
        'low',
        `${platform.toUpperCase()} diagnostic health is missing or stale.`,
        allRecords.map(item => item.id),
        window,
        'Treat as unknown and request an approved fresh evidence source; do not infer health.',
        allRecords.map(item => item.observedAt)
      );
    const eventRecords = records.filter(item => item.eventIds !== undefined);
    const eventFinding = eventRecords.length > 0
      ? finding(
        'observability-quality',
        'fact',
        'high',
        `${platform.toUpperCase()} source reports ${new Set(eventRecords.flatMap(item => item.eventIds ?? [])).size} unique events after deduplication.`,
        eventRecords.map(item => item.id),
        window,
        'Use only the deduplicated aggregate in review; no event identifiers are included.',
        eventRecords.map(item => item.observedAt)
      )
      : finding(
        'observability-quality',
        'unknown',
        'low',
        `${platform.toUpperCase()} event count is unavailable.`,
        allRecords.map(item => item.id),
        window,
        'Treat the count as unknown until an approved source provides it.',
        allRecords.map(item => item.observedAt)
      );
    result[platform] = [healthFinding, eventFinding];
    return result;
  }, {} as Record<MobilePlatform, PilotFinding[]>);

  const iosRecords = usable.filter(item => item.source === 'ios_diagnostics' && item.platform === 'ios');
  const iosProof = iosRecords.find(item =>
    item.iosCollectorProof?.signedNetworkExtension === true &&
    item.iosCollectorProof.signatureValid === true &&
    item.iosCollectorProof.physicalDeviceValidated === true
  );
  platforms.ios.push(iosProof
    ? finding(
      'observability-quality',
      'fact',
      'high',
      'The approved evidence source reports a signed Network Extension validated on a physical device.',
      [iosProof.id],
      window,
      'Have a human review the referenced validation evidence; this report does not perform verification.',
      [iosProof.observedAt]
    )
    : finding(
      'observability-quality',
      'unknown',
      'low',
      'iOS collector verification is unknown; no qualifying signed Network Extension and physical-device evidence was supplied.',
      iosRecords.map(item => item.id),
      window,
      'Do not claim collector verification; obtain signed physical-device validation evidence through an approved process.',
      iosRecords.map(item => item.observedAt)
    ));

  const health = usable.filter(item => item.source === 'api_health' && item.health !== undefined)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
  const api = [health
    ? finding(
      'api-service-watcher',
      'fact',
      'high',
      `API health source reports ${health.health}.`,
      [health.id],
      window,
      'Review this observation; no service action was performed.',
      [health.observedAt]
    )
    : finding(
      'api-service-watcher',
      'unknown',
      'low',
      'API health is missing or stale.',
      bundle.evidence.filter(item => item.source === 'api_health').map(item => item.id),
      window,
      'Treat as unknown and request an approved fresh health source.',
      bundle.evidence.filter(item => item.source === 'api_health').map(item => item.observedAt)
    )];

  const revocations = bundle.revocations ?? [];
  const consent = revocations.length === 0
    ? [finding(
      'consent-guardian',
      'unknown',
      'low',
      'No fresh consent-revocation evidence was supplied.',
      revocations.map(item => item.id),
      window,
      'Treat consent and downstream processing status as unknown; do not change consent.',
      revocations.map(item => item.observedAt)
    )]
    : revocations.map(item => {
      const isFresh = fresh(item.observedAt, bundle.generatedAt, bundle.freshnessMs) &&
        sameWindow(item.window, bundle.window);
      const status: FindingStatus = !isFresh || item.revocation !== 'revoked' || item.downstream === 'unknown'
        ? 'unknown'
        : item.downstream === 'processing' ? 'inference' : 'fact';
      return finding(
        'consent-guardian',
        status,
        status === 'fact' ? 'high' : status === 'inference' ? 'medium' : 'low',
        !isFresh
          ? 'Revocation evidence is stale or outside the reporting window.'
          : item.revocation !== 'revoked'
            ? 'Revocation is not confirmed by the supplied evidence.'
            : item.downstream === 'blocked'
              ? 'Revocation evidence and downstream blocking are both reported.'
              : item.downstream === 'processing'
                ? 'Revocation is reported, but downstream processing is still reported as active.'
                : 'Revocation is reported; downstream processing status is unknown.',
        [item.id],
        window,
        'Review source evidence; the guardian never grants, changes, or revokes consent.',
        [item.observedAt]
      );
    });

  const counts = bundle.counts ?? [];
  const comparable = counts.filter(item =>
    Number.isSafeInteger(item.count) && item.count >= 0 &&
    item.definition.trim().length > 0 &&
    sameWindow(item.window, bundle.window) &&
    fresh(item.observedAt, bundle.generatedAt, bundle.freshnessMs)
  );
  const expectedSources = ['device', 'api', 'audit', 'database'];
  const reference = comparable[0];
  const completeScope = expectedSources.every(source =>
    comparable.filter(item => item.source === source).length === 1
  );
  const allAligned = completeScope && reference !== undefined &&
    expectedSources.every(source => {
      const item = comparable.find(candidate => candidate.source === source);
      return item?.definition === reference.definition && sameWindow(item.window, reference.window);
    });
  const values = allAligned
    ? expectedSources.map(source => comparable.find(item => item.source === source)!.count)
    : [];
  const uniqueValues = new Set(values);
  const reconciliation = [!allAligned
    ? finding(
      'reconciliation',
      'unknown',
      'low',
      'Counts are incomplete, stale, or incomparable by definition or reporting window.',
      counts.map(item => item.id),
      window,
      'Mark unmatched scopes unknown; define aligned sources and windows before comparing counts.',
      counts.map(item => item.observedAt)
    )
    : uniqueValues.size === 1
      ? finding(
        'reconciliation',
        'fact',
        'high',
        `All four aligned sources report ${values[0]} records.`,
        comparable.filter(item => expectedSources.includes(item.source)).map(item => item.id),
        window,
        'Record the aligned comparison; no data was modified.',
        comparable.filter(item => expectedSources.includes(item.source)).map(item => item.observedAt)
      )
      : finding(
        'reconciliation',
        'inference',
        'medium',
        'Aligned source counts differ; this indicates a mismatch requiring human investigation.',
        comparable.filter(item => expectedSources.includes(item.source)).map(item => item.id),
        window,
        'Investigate the discrepancy in an approved read-only review; no reconciliation write was performed.',
        comparable.filter(item => expectedSources.includes(item.source)).map(item => item.observedAt)
      )];

  return {
    runId: safeRunId(bundle.runId),
    generatedAt: safeTimestamp(bundle.generatedAt),
    window,
    rulesVersion: 'kick-013-v1',
    limitations: [
      'Evidence is caller-supplied; this builder does not authenticate sources or independently verify facts.',
      'Recommendations are advisory; no execution path is enabled.',
      'Missing, stale, and incomparable signals remain unknown.'
    ],
    failures: (bundle.sourceFailures ?? [])
      .filter(item => [
        'android_diagnostics', 'ios_diagnostics', 'api_health',
        'device', 'api', 'audit', 'database', 'consent_audit'
      ].includes(item.source))
      .map(item => ({
        source: item.source,
        observedAt: safeTimestamp(item.observedAt)
      })),
    platforms,
    api,
    consent,
    reconciliation
  };
}
