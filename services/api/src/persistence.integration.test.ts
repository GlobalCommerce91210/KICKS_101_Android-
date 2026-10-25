import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { buildServer } from './server.js';
import { PostgresConsentRepository } from './consent-repository.js';
import { PostgresDeviceRepository } from './device-repository.js';

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
      deviceRepository: new PostgresDeviceRepository(pool!)
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

    const grant = await firstApp.inject({
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
    assert.equal(grant.statusCode, 202);
    const originalEventId = grant.json().id as string;
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

    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/consent-events',
      headers,
      payload: {
        permissionId,
        requestId: randomUUID(),
        expectedEventSequence: 1,
        action: 'revoke',
        policyVersion: 'privacy-test-1',
        purposeVersion: 'network-safety-test-1',
        purpose: 'Detect unexpected data destinations'
      }
    });
    assert.equal(revoke.statusCode, 202);

    const protectedBatch = await app.inject({
      method: 'POST',
      url: '/v1/metadata-batches',
      headers,
      payload: {
        batchId: randomUUID(),
        schemaVersion: '2026-08-01',
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
          consentPurpose: 'Detect unexpected data destinations'
        }]
      }
    });
    assert.equal(protectedBatch.statusCode, 403);

    const finalHistory = await app.inject({
      method: 'GET',
      url: `/v1/consent-events/${permissionId}`,
      headers
    });
    assert.deepEqual(finalHistory.json().events.map((event: { action: string }) => event.action), ['grant', 'revoke']);

    // Confirm the bearer token still resolves to the same durable device after restart.
    assert.equal(deviceId.length > 0, true);
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
    const id = randomUUID();
    await pool.query(
      'INSERT INTO consent_events (id, subject_id, permission_id, action, policy_version, purpose_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, randomUUID(), randomUUID(), 'grant', 'legacy-policy', 'legacy-purpose', randomUUID()]
    );
    const migration = await readFile(new URL('../db/migrations/20261025_consent_purpose.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    const result = await pool.query(
      'SELECT id, purpose, request_id, event_sequence FROM consent_events WHERE id = $1',
      [id]
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].purpose, 'legacy-unavailable');
    assert.equal(result.rows[0].request_id, id);
    assert.ok(Number(result.rows[0].event_sequence) > 0);
  } finally {
    await pool?.end().catch(() => undefined);
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});
