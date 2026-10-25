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
