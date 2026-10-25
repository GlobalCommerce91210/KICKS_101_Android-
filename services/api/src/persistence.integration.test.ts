import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { buildServer } from './server.js';
import { PostgresConsentRepository } from './consent-repository.js';
import { PostgresDeviceRepository } from './device-repository.js';
import { PostgresMetadataRepository } from './metadata-repository.js';

const databaseUrl = process.env.KICKS_TEST_DATABASE_URL;

test('PostgreSQL device identity and consent history survive an API restart', { skip: !databaseUrl }, async () => {
  // KICKS_TEST_DATABASE_URL must point to a disposable test database. All test
  // tables are isolated in a uniquely named schema; no existing tables are dropped.
  const adminPool = new Pool({ connectionString: databaseUrl });
  const schema = `kicks_test_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildServer> | undefined;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
      max: 3
    });
    const schemaSql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
    await pool.query(schemaSql);

    const repositories = () => ({
      consentRepository: new PostgresConsentRepository(pool!),
      deviceRepository: new PostgresDeviceRepository(pool!),
      metadataRepository: new PostgresMetadataRepository(pool!),
      collectorVerifier: { verify: async () => true }
    });
    const adminSecret = 'test-only-secret';
    const subjectId = randomUUID();
    const permissionId = randomUUID();
    const requestId = randomUUID();
    const firstApp = buildServer({ ...repositories(), adminSecret });

    const enrollment = await firstApp.inject({
      method: 'POST',
      url: '/v1/staging/devices',
      headers: { 'x-admin-secret': adminSecret },
      payload: { subjectId }
    });
    assert.equal(enrollment.statusCode, 201);
    const { token, deviceId } = enrollment.json() as { token: string; deviceId: string };
    const headers = { authorization: `Bearer ${token}` };

    const grantPayload = {
      permissionId,
      requestId,
      expectedEventSequence: 0,
      action: 'grant' as const,
      policyVersion: 'privacy-test-1',
      purposeVersion: 'network-safety-test-1',
      purpose: 'Detect unexpected data destinations'
    };
    const [grant, simultaneousRetry] = await Promise.all([
      firstApp.inject({ method: 'POST', url: '/v1/consent-events', headers, payload: grantPayload }),
      firstApp.inject({ method: 'POST', url: '/v1/consent-events', headers, payload: grantPayload })
    ]);
    assert.equal(grant.statusCode, 202);
    assert.equal(simultaneousRetry.statusCode, 202);
    const originalEventId = grant.json().id as string;
    assert.equal(simultaneousRetry.json().id, originalEventId);
    await firstApp.close();
    app = undefined;

    // Recreate the API and repository objects while keeping only PostgreSQL
    // alive, modelling a process restart rather than reusing in-memory state.
    app = buildServer({ ...repositories(), adminSecret });
    const history = await app.inject({
      method: 'GET',
      url: `/v1/consent-events/${permissionId}`,
      headers
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().events.length, 1);
    assert.equal(history.json().events[0].id, originalEventId);
    assert.equal(history.json().events[0].action, 'grant');

    const retry = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId,
        expectedEventSequence: 0,
        action: 'grant',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(retry.statusCode, 202);
    assert.equal(retry.json().id, originalEventId);

    const changedExpectedSequence = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId,
        expectedEventSequence: 7,
        action: 'grant',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(changedExpectedSequence.statusCode, 409);
    assert.equal(changedExpectedSequence.json().error, 'idempotency_key_reused_with_different_request');

    // A globally reused request ID with a different permission/payload must conflict,
    // not surface as a generic database outage even when requests race.
    const conflictingRetry = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId: randomUUID(),
        requestId,
        expectedEventSequence: 0,
        action: 'grant',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(conflictingRetry.statusCode, 409);
    assert.equal(conflictingRetry.json().error, 'idempotency_key_reused_with_different_request');

    const staleDecision = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId: randomUUID(),
        expectedEventSequence: 0,
        action: 'revoke',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(staleDecision.statusCode, 409);
    assert.equal(staleDecision.json().error, 'stale_consent_decision');

    const concurrentDecisions = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/consent-events',
        headers,
        payload: {
          permissionId,
          requestId: randomUUID(),
          expectedEventSequence: 1,
          action: 'grant',
          policyVersion: 'privacy-test-1',
          purposeVersion: 'network-safety-test-1',
          purpose: 'Detect unexpected data destinations'
        }
      }),
      app.inject({
        method: 'POST',
        url: '/v1/consent-events',
        headers,
        payload: {
          permissionId,
          requestId: randomUUID(),
          expectedEventSequence: 1,
          action: 'grant',
          policyVersion: 'privacy-test-1',
          purposeVersion: 'network-safety-test-1',
          purpose: 'Detect unexpected data destinations'
        }
      })
    ]);
    assert.deepEqual(concurrentDecisions.map(response => response.statusCode).sort(), [202, 409]);
    assert.equal(concurrentDecisions.find(response => response.statusCode === 409)?.json().error, 'stale_consent_decision');

    const deniedPermissionId = randomUUID();
    const deniedDecision = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId: deniedPermissionId,
        requestId: randomUUID(),
        expectedEventSequence: 0,
        action: 'deny',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(deniedDecision.statusCode, 202);
    assert.equal(deniedDecision.json().eventSequence, 1);
    const deniedEligibility = await app.inject({
      method: 'POST',
      url: '/v1/collector/eligibility',
      headers,
      payload: {
        permissionId: deniedPermissionId,
        purpose: 'Detect unexpected data destinations',
        activationRequested: true
      }
    });
    assert.equal(deniedEligibility.statusCode, 403);

    const acceptedBatchId = randomUUID();
    const acceptedEventId = randomUUID();
    const acceptedBatch = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: acceptedBatchId,
        schemaVersion: '2026-10-25',
        observations: [{
          eventId: acceptedEventId,
          occurredAt: new Date().toISOString(),
          sourceApp: 'com.example.test',
          attribution: 'verified',
          destinationHost: 'api.example.com',
          protocol: 'tls',
          bytesBucket: '1-10KB',
          classification: 'expected',
          consentId: permissionId,
          consentPurpose: 'Detect unexpected data destinations',
          consentPolicyVersion: 'privacy-test-1',
          consentPurposeVersion: 'network-safety-test-1'
        }]
      }
    });
    assert.equal(acceptedBatch.statusCode, 202);
    const persistedBatch = await pool!.query('SELECT observation_count FROM metadata_batches WHERE id = $1', [acceptedBatchId]);
    assert.equal(persistedBatch.rows[0]?.observation_count, 1);
    const persistedObservation = await pool!.query('SELECT id FROM metadata_observations WHERE id = $1', [acceptedEventId]);
    assert.equal(persistedObservation.rows.length, 1);
    const consentBinding = await pool!.query(
      `SELECT consent_event_id, consent_policy_version, consent_purpose_version
       FROM metadata_observations WHERE id = $1`,
      [acceptedEventId]
    );
    const currentConsentEvent = await pool!.query(
      'SELECT id FROM consent_events WHERE permission_id = $1 ORDER BY event_sequence DESC LIMIT 1',
      [permissionId]
    );
    assert.equal(consentBinding.rows[0]?.consent_event_id, currentConsentEvent.rows[0]?.id);
    assert.equal(consentBinding.rows[0]?.consent_policy_version, 'privacy-test-1');
    assert.equal(consentBinding.rows[0]?.consent_purpose_version, 'network-safety-test-1');
    const stalePolicyBatchId = randomUUID();
    const stalePolicy = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: stalePolicyBatchId,
        schemaVersion: '2026-10-25',
        observations: [{
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          sourceApp: 'com.example.test',
          attribution: 'verified',
          destinationHost: 'api.example.com',
          protocol: 'tls',
          bytesBucket: '1-10KB',
          classification: 'expected',
          consentId: permissionId,
          consentPurpose: 'Detect unexpected data destinations',
          consentPolicyVersion: 'privacy-old',
          consentPurposeVersion: 'network-safety-test-1'
        }]
      }
    });
    assert.equal(stalePolicy.statusCode, 403);
    assert.equal((await pool!.query('SELECT id FROM metadata_batches WHERE id = $1', [stalePolicyBatchId])).rows.length, 0);

    const wrongDeviceIdentity = await assert.rejects(
      new PostgresMetadataRepository(pool!).ingestBatch(
        { id: deviceId, subjectId, tokenHash: 'not-the-current-token-hash', revoked: false },
        {
          batchId: randomUUID(),
          schemaVersion: '2026-10-25',
          observations: [{
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            sourceApp: 'com.example.test',
            attribution: 'verified',
            destinationHost: 'api.example.com',
            protocol: 'tls',
            bytesBucket: '1-10KB',
            classification: 'expected',
            consentId: permissionId,
            consentPurpose: 'Detect unexpected data destinations',
            consentPolicyVersion: 'privacy-test-1',
            consentPurposeVersion: 'network-safety-test-1'
          }]
        }
      ),
      (error: unknown) => (error as { code?: string }).code === 'DEVICE_NOT_ACTIVE'
    );
    assert.equal(wrongDeviceIdentity, undefined);

    const replayedBatch = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: acceptedBatchId,
        schemaVersion: '2026-10-25',
        observations: [{
          eventId: acceptedEventId,
          occurredAt: new Date().toISOString(),
          sourceApp: 'com.example.test',
          attribution: 'verified',
          destinationHost: 'api.example.com',
          protocol: 'tls',
          bytesBucket: '1-10KB',
          classification: 'expected',
          consentId: permissionId,
          consentPurpose: 'Detect unexpected data destinations',
          consentPolicyVersion: 'privacy-test-1',
          consentPurposeVersion: 'network-safety-test-1'
        }]
      }
    });
    assert.equal(replayedBatch.statusCode, 409);
    assert.equal(replayedBatch.json().error, 'replay_detected');

    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId: randomUUID(),
        expectedEventSequence: 2,
        action: 'revoke',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(revoke.statusCode, 202);

    const revokedBatchId = randomUUID();
    const revokedEventId = randomUUID();
    const protectedBatch = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: revokedBatchId,
        schemaVersion: '2026-10-25',
        observations: [{
          eventId: revokedEventId,
          occurredAt: new Date().toISOString(),
          sourceApp: 'com.example.test',
          attribution: 'verified',
          destinationHost: 'api.example.com',
          protocol: 'tls',
          bytesBucket: '1-10KB',
          classification: 'expected',
          consentId: permissionId,
          consentPurpose: 'Detect unexpected data destinations',
          consentPolicyVersion: 'privacy-test-1',
          consentPurposeVersion: 'network-safety-test-1'
        }]
      }
    });
    assert.equal(protectedBatch.statusCode, 403);
    assert.equal((await pool!.query('SELECT id FROM metadata_batches WHERE id = $1', [revokedBatchId])).rows.length, 0);
    assert.equal((await pool!.query('SELECT id FROM metadata_observations WHERE id = $1', [revokedEventId])).rows.length, 0);

    const finalHistory = await app.inject({
      method: 'GET',
      url: `/v1/consent-events/${permissionId}`,
      headers
    });
    assert.deepEqual(finalHistory.json().events.map((event: { action: string }) => event.action), ['grant', 'grant', 'revoke']);

    const racePermissionId = randomUUID();
    const raceGrant = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId: racePermissionId,
        requestId: randomUUID(),
        expectedEventSequence: 0,
        action: 'grant',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(raceGrant.statusCode, 202);
    const racedBatchId = randomUUID();
    const racedEventId = randomUUID();
    const [racedIngestion, racedRevocation] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/metadata-batches',
        headers,
        payload: {
          batchId: racedBatchId,
          schemaVersion: '2026-10-25',
          observations: [{
            eventId: racedEventId,
            occurredAt: new Date().toISOString(),
            sourceApp: 'com.example.test',
            attribution: 'verified',
            destinationHost: 'api.example.com',
            protocol: 'tls',
            bytesBucket: '1-10KB',
            classification: 'expected',
            consentId: racePermissionId,
            consentPurpose: 'Detect unexpected data destinations',
            consentPolicyVersion: 'privacy-test-1',
            consentPurposeVersion: 'network-safety-test-1'
          }]
        }
      }),
      app.inject({
        method: 'POST',
        url: '/v1/consent-events',
        headers,
        payload: {
          permissionId: racePermissionId,
          requestId: randomUUID(),
          expectedEventSequence: 1,
          action: 'revoke',
          policyVersion: 'privacy-test-1',
          purposeVersion: 'network-safety-test-1',
          purpose: 'Detect unexpected data destinations'
        }
      })
    ]);
    assert.equal(racedRevocation.statusCode, 202);
    assert.ok([202, 403].includes(racedIngestion.statusCode));
    const racedRows = await pool!.query(
      `SELECT batch.id, observation.id AS event_id
       FROM metadata_batches AS batch
       LEFT JOIN metadata_observations AS observation ON observation.batch_id = batch.id
       WHERE batch.id = $1`,
      [racedBatchId]
    );
    if (racedIngestion.statusCode === 202) {
      assert.equal(racedRows.rows.length, 1);
      assert.equal(racedRows.rows[0]?.event_id, racedEventId);
    } else {
      assert.equal(racedRows.rows.length, 0);
    }
    const afterRevocation = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: randomUUID(),
        schemaVersion: '2026-10-25',
        observations: [{
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          sourceApp: 'com.example.test',
          attribution: 'verified',
          destinationHost: 'api.example.com',
          protocol: 'tls',
          bytesBucket: '1-10KB',
          classification: 'expected',
          consentId: racePermissionId,
          consentPurpose: 'Detect unexpected data destinations',
          consentPolicyVersion: 'privacy-test-1',
          consentPurposeVersion: 'network-safety-test-1'
        }]
      }
    });
    assert.equal(afterRevocation.statusCode, 403);

    const deviceRevocation = await app.inject({ method: 'POST', url: '/v1/devices/revoke', headers });
    assert.equal(deviceRevocation.statusCode, 200);
    assert.equal(deviceRevocation.json().deviceId, deviceId);
    const rejectedAfterDeviceRevocation = await app.inject({
      method: 'GET',
      url: `/v1/consent-events/${permissionId}`,
      headers
    });
    assert.equal(rejectedAfterDeviceRevocation.statusCode, 401);
  } finally {
    await app?.close().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});


test('consent migration preserves legacy rows and assigns non-authorizing purpose', { skip: !databaseUrl }, async () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const schema = `kicks_migration_test_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE consent_events (
        id uuid PRIMARY KEY,
        subject_id uuid NOT NULL,
        permission_id uuid NOT NULL,
        action text NOT NULL CHECK (action IN ('grant','deny','revoke')),
        policy_version text NOT NULL,
        purpose_version text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        correlation_id uuid NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE metadata_observations (
        id uuid PRIMARY KEY,
        batch_id uuid NOT NULL,
        consent_id uuid NOT NULL
      )
    `);
    const id = randomUUID();
    const secondId = randomUUID();
    const permissionId = randomUUID();
    const subjectId = randomUUID();
    const observationId = randomUUID();
    await pool.query(
      'INSERT INTO consent_events (id, subject_id, permission_id, action, policy_version, purpose_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, subjectId, permissionId, 'grant', 'legacy-policy', 'legacy-purpose', randomUUID()]
    );
    await pool.query(
      'INSERT INTO consent_events (id, subject_id, permission_id, action, policy_version, purpose_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [secondId, subjectId, permissionId, 'revoke', 'legacy-policy', 'legacy-purpose', randomUUID()]
    );
    await pool.query(
      'INSERT INTO metadata_observations (id, batch_id, consent_id) VALUES ($1,$2,$3)',
      [observationId, randomUUID(), permissionId]
    );
    const consentMigration = await readFile(new URL('../db/migrations/20261025_consent_purpose.sql', import.meta.url), 'utf8');
    await pool.query(consentMigration);
    await pool.query(consentMigration);
    const priorMigrationColumns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'metadata_observations'
         AND column_name IN ('consent_event_id', 'consent_policy_version', 'consent_purpose_version')`
    );
    assert.equal(priorMigrationColumns.rows.length, 0);
    const metadataMigration = await readFile(
      new URL('../db/migrations/20261025_metadata_consent_binding.sql', import.meta.url),
      'utf8'
    );
    await pool.query(metadataMigration);
    const firstBackfill = await pool.query(
      'SELECT id, event_sequence, expected_event_sequence FROM consent_events ORDER BY event_sequence'
    );
    await pool.query(metadataMigration);
    const repeatedBackfill = await pool.query(
      'SELECT id, event_sequence, expected_event_sequence FROM consent_events ORDER BY event_sequence'
    );
    assert.deepEqual(repeatedBackfill.rows, firstBackfill.rows);
    assert.equal(firstBackfill.rows.length, 2);
    for (const event of firstBackfill.rows) {
      assert.equal(Number(event.expected_event_sequence), Number(event.event_sequence) - 1);
    }
    const history = await new PostgresConsentRepository(pool).getHistory(permissionId, subjectId);
    assert.deepEqual(history.map(event => event.expectedEventSequence), [0, 1]);
    const result = await pool.query(
      'SELECT id, purpose, request_id, event_sequence, expected_event_sequence FROM consent_events WHERE id = $1',
      [id]
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].purpose, 'legacy-unavailable');
    assert.equal(result.rows[0].request_id, id);
    assert.ok(Number(result.rows[0].event_sequence) > 0);
    assert.equal(Number(result.rows[0].expected_event_sequence), Number(result.rows[0].event_sequence) - 1);
    const legacyBinding = await pool.query(
      `SELECT consent_event_id, consent_policy_version, consent_purpose_version
       FROM metadata_observations WHERE id = $1`,
      [observationId]
    );
    assert.equal(legacyBinding.rows[0]?.consent_event_id, null);
    assert.equal(legacyBinding.rows[0]?.consent_policy_version, 'legacy-unavailable');
    assert.equal(legacyBinding.rows[0]?.consent_purpose_version, 'legacy-unavailable');
    const stream = await pool.query(
      'SELECT last_sequence FROM consent_permission_sequences WHERE permission_id = (SELECT permission_id FROM consent_events WHERE id = $1)',
      [id]
    );
    assert.equal(Number(stream.rows[0]?.last_sequence), 2);
  } finally {
    await pool?.end().catch(() => undefined);
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});

test('consent migration converts legacy global ordering once and remains compatible with new writes', { skip: !databaseUrl }, async () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const schema = `kicks_sequence_migration_test_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE consent_events (
        id uuid PRIMARY KEY,
        event_sequence bigserial UNIQUE NOT NULL,
        subject_id uuid NOT NULL,
        permission_id uuid NOT NULL,
        action text NOT NULL CHECK (action IN ('grant','deny','revoke')),
        policy_version text NOT NULL,
        purpose_version text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        correlation_id uuid NOT NULL
      )
    `);
    const subjectId = randomUUID();
    const permissionId = randomUUID();
    const otherPermissionId = randomUUID();
    const firstId = randomUUID();
    const otherId = randomUUID();
    const secondId = randomUUID();
    for (const [id, permission] of [
      [firstId, permissionId],
      [otherId, otherPermissionId],
      [secondId, permissionId]
    ]) {
      await pool.query(
        'INSERT INTO consent_events (id, subject_id, permission_id, action, policy_version, purpose_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, subjectId, permission, 'grant', 'legacy-policy', 'legacy-purpose', randomUUID()]
      );
    }

    const migration = await readFile(new URL('../db/migrations/20261025_consent_purpose.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    const migrated = await pool.query(
      'SELECT id, event_sequence FROM consent_events ORDER BY id'
    );
    const firstSequence = new Map(migrated.rows.map(row => [row.id, Number(row.event_sequence)]));
    assert.equal(firstSequence.get(firstId), 1);
    assert.equal(firstSequence.get(otherId), 1);
    assert.equal(firstSequence.get(secondId), 2);

    await pool.query(migration);
    const repeated = await pool.query('SELECT id, event_sequence FROM consent_events ORDER BY id');
    assert.deepEqual(
      repeated.rows.map(row => [row.id, Number(row.event_sequence)]),
      migrated.rows.map(row => [row.id, Number(row.event_sequence)])
    );

    const event = await new PostgresConsentRepository(pool).recordDecision({
      permissionId,
      requestId: randomUUID(),
      expectedEventSequence: 2,
      subjectId,
      action: 'revoke',
      policyVersion: 'privacy-test-1',
      purposeVersion: 'network-safety-test-1',
      purpose: 'Detect unexpected data destinations'
    });
    assert.equal(event.eventSequence, 3);
  } finally {
    await pool?.end().catch(() => undefined);
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});
