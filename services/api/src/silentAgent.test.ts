import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPilotReport, CountEvidence, PilotEvidenceBundle } from './silentAgent.js';

const generatedAt = '2026-10-25T12:00:00.000Z';
const window = {
  start: '2026-10-25T11:00:00.000Z',
  end: generatedAt
};
const freshAt = '2026-10-25T11:59:00.000Z';
const base = (overrides: Partial<PilotEvidenceBundle> = {}): PilotEvidenceBundle => ({
  runId: 'run:1',
  generatedAt,
  window,
  freshnessMs: 5 * 60 * 1000,
  evidence: [],
  ...overrides
});
const counts = (values: number[], overrides: Partial<CountEvidence> = {}): CountEvidence[] =>
  (['device', 'api', 'audit', 'database'] as const).map((source, index) => ({
    id: `evidence:count-${source}`,
    source,
    count: values[index]!,
    definition: 'accepted-events',
    window,
    observedAt: freshAt,
    ...overrides
  }));

test('missing and stale signals are unknown, not healthy or zero', () => {
  const report = buildPilotReport(base({
    evidence: [{
      id: 'evidence:old-api-health',
      source: 'api_health',
      observedAt: '2026-10-25T11:00:00.000Z',
      window,
      health: 'healthy'
    }]
  }));

  assert.equal(report.api[0]?.status, 'unknown');
  assert.equal(report.platforms.android[0]?.status, 'unknown');
  assert.match(report.platforms.android[1]?.summary ?? '', /unavailable/);
  assert.equal(report.platforms.ios[0]?.status, 'unknown');
});

test('platform evidence stays separate and duplicate event IDs are counted once', () => {
  const report = buildPilotReport(base({
    evidence: [
      {
        id: 'evidence:android-source',
        source: 'android_diagnostics',
        platform: 'android',
        observedAt: freshAt,
        window,
        health: 'healthy',
        eventIds: ['event-a', 'event-a', 'event-b']
      },
      {
        id: 'evidence:ios-source',
        source: 'ios_diagnostics',
        platform: 'ios',
        observedAt: freshAt,
        window,
        health: 'unhealthy',
        eventIds: ['event-c']
      }
    ]
  }));

  assert.match(report.platforms.android[0]?.summary ?? '', /reports healthy/);
  assert.match(report.platforms.ios[0]?.summary ?? '', /reports unhealthy/);
  assert.match(report.platforms.android[1]?.summary ?? '', /2 unique events/);
  assert.match(report.platforms.ios[1]?.summary ?? '', /1 unique events/);
  assert.equal(report.platforms.android[0]?.evidenceRefs[0], 'evidence:android-source');
  assert.equal(report.platforms.ios[0]?.evidenceRefs[0], 'evidence:ios-source');
});

test('reconciliation only compares complete aligned scopes and labels mismatches as inference', () => {
  const mismatch = buildPilotReport(base({ counts: counts([4, 5, 4, 4]) }));
  assert.equal(mismatch.reconciliation[0]?.status, 'inference');

  const incompatibleCounts = counts([4, 4, 4, 4]);
  incompatibleCounts[3]!.definition = 'different-definition';
  const incomparable = buildPilotReport(base({ counts: incompatibleCounts }));
  assert.equal(incomparable.reconciliation[0]?.status, 'unknown');

  const mismatchedWindowCounts = counts([4, 4, 4, 4]);
  mismatchedWindowCounts[3]!.window = {
    start: '2026-10-25T10:00:00.000Z',
    end: generatedAt
  };
  const mismatchedWindow = buildPilotReport(base({ counts: mismatchedWindowCounts }));
  assert.equal(mismatchedWindow.reconciliation[0]?.status, 'unknown');

  const incomplete = buildPilotReport(base({ counts: counts([4, 4, 4, 4]).slice(1) }));
  assert.equal(incomplete.reconciliation[0]?.status, 'unknown');
});

test('revocation facts require downstream blocking evidence', () => {
  const report = buildPilotReport(base({
    revocations: [
      { id: 'evidence:revoked-blocked', observedAt: freshAt, window, revocation: 'revoked', downstream: 'blocked' },
      { id: 'evidence:revoked-processing', observedAt: freshAt, window, revocation: 'revoked', downstream: 'processing' },
      { id: 'evidence:stale-revocation', observedAt: '2026-10-25T11:00:00.000Z', window, revocation: 'revoked', downstream: 'blocked' }
    ]
  }));

  assert.equal(report.consent[0]?.status, 'fact');
  assert.equal(report.consent[0]?.confidence, 'high');
  assert.equal(report.consent[1]?.status, 'inference');
  assert.equal(report.consent[2]?.status, 'unknown');
});

test('iOS verification remains unknown without signed physical-device evidence', () => {
  const unsupported = buildPilotReport(base({
    evidence: [{
      id: 'evidence:ios-unverified',
      source: 'ios_diagnostics',
      platform: 'ios',
      observedAt: freshAt,
      window,
      health: 'healthy',
      iosCollectorProof: {
        signedNetworkExtension: false,
        signatureValid: true,
        physicalDeviceValidated: false
      }
    }]
  }));
  assert.equal(unsupported.platforms.ios[2]?.status, 'unknown');
  assert.doesNotMatch(unsupported.platforms.ios[2]?.summary ?? '', /validated on a physical device/);

  const supported = buildPilotReport(base({
    evidence: [{
      id: 'evidence:ios-validated',
      source: 'ios_diagnostics',
      platform: 'ios',
      observedAt: freshAt,
      window,
      iosCollectorProof: {
        signedNetworkExtension: true,
        signatureValid: true,
        physicalDeviceValidated: true
      }
    }]
  }));
  assert.equal(supported.platforms.ios[2]?.status, 'fact');
  assert.match(supported.platforms.ios[2]?.summary ?? '', /signed Network Extension validated on a physical device/);
});

test('report references redact credentials, email addresses, and personal identifiers', () => {
  const privateId = '****** test@example.com 123e4567-e89b-12d3-a456-426614174000';
  const report = buildPilotReport(base({
    runId: privateId,
    sourceFailures: [{ source: 'ios_diagnostics', observedAt: 'invalid timestamp' }],
    evidence: [{
      id: privateId,
      source: 'api_health',
      observedAt: freshAt,
      window,
      health: 'healthy'
    }]
  }));
  const serialized = JSON.stringify(report);

  assert.doesNotMatch(serialized, /secret-token|test@example\.com|123e4567-e89b-12d3-a456-426614174000/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.equal(report.rulesVersion, 'kick-013-v1');
  assert.equal(report.failures[0]?.observedAt, 'unknown');
  assert.ok(report.limitations.length > 0);
  assert.deepEqual(report.api[0]?.sourceTimestamps, [freshAt]);
});

test('duplicate evidence scopes make count comparisons unknown', () => {
  const aligned = counts([2, 2, 2, 2]);
  const report = buildPilotReport(base({ counts: [...aligned, aligned[0]!] }));

  assert.equal(report.reconciliation[0]?.status, 'unknown');
});
