import type { Pool } from 'pg';
import type { DeviceRecord } from './device-repository.js';

export type MetadataObservation = {
  eventId: string;
  occurredAt: string;
  sourceApp: string | null;
  attribution: 'verified' | 'best_effort' | 'unknown';
  destinationHost: string;
  protocol: 'dns' | 'tcp' | 'udp' | 'tls' | 'quic' | 'other';
  bytesBucket: '0-1KB' | '1-10KB' | '10-100KB' | '100KB-1MB' | '1MB+';
  classification: 'expected' | 'review' | 'unpermissioned' | 'unknown';
  consentId: string;
  consentPurpose: string;
};
export type MetadataBatch = {
  batchId: string;
  schemaVersion: '2026-08-01';
  observations: MetadataObservation[];
};
export interface MetadataRepository {
  ingestBatch(device: DeviceRecord, batch: MetadataBatch, authorize?: (transaction: unknown) => Promise<void>): Promise<{ batchId: string; accepted: number }>;
}

export class PostgresMetadataRepository implements MetadataRepository {
  constructor(private readonly pool: Pool) {}

  async ingestBatch(device: DeviceRecord, batch: MetadataBatch, authorize?: (transaction: unknown) => Promise<void>): Promise<{ batchId: string; accepted: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const activeDevice = await client.query<{ id: string }>(
        'SELECT id FROM devices WHERE id = $1 AND subject_id = $2 AND revoked_at IS NULL FOR UPDATE',
        [device.id, device.subjectId]
      );
      if (!activeDevice.rows[0]) {
        const error = new Error('device_not_active');
        (error as Error & { code?: string }).code = 'DEVICE_NOT_ACTIVE';
        throw error;
      }

      const permissionIds = [...new Set(batch.observations.map(item => item.consentId))].sort();
      for (const permissionId of permissionIds) {
        // Share the same permission-stream lock as consent grant/revoke writes.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`permission:${permissionId}`]);
      }

      for (const permissionId of permissionIds) {
        const latest = await client.query<{
          subject_id: string; action: 'grant' | 'deny' | 'revoke'; purpose: string;
        }>(
          'SELECT subject_id, action, purpose FROM consent_events WHERE permission_id = $1 ORDER BY event_sequence DESC LIMIT 1',
          [permissionId]
        );
        const consent = latest.rows[0];
        const matching = batch.observations.filter(item => item.consentId === permissionId);
        if (!consent || consent.subject_id !== device.subjectId || consent.action !== 'grant' ||
          matching.some(item => item.consentPurpose !== consent.purpose)) {
          const error = new Error('active_purpose_consent_required');
          (error as Error & { code?: string }).code = 'ACTIVE_PURPOSE_CONSENT_REQUIRED';
          throw error;
        }
      }

      // Re-validate collector authorization inside the same transaction, after the permission locks, so a concurrent revocation cannot commit data.
      if (authorize) await authorize(client);

      await client.query(
        'INSERT INTO metadata_batches (id, device_id, schema_version, observation_count) VALUES ($1, $2, $3, $4)',
        [batch.batchId, device.id, batch.schemaVersion, batch.observations.length]
      );
      for (const item of batch.observations) {
        await client.query(
          `INSERT INTO metadata_observations
            (id, batch_id, consent_id, occurred_at, source_app, attribution, destination_host, protocol, bytes_bucket, classification, consent_purpose)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [item.eventId, batch.batchId, item.consentId, item.occurredAt, item.sourceApp, item.attribution,
            item.destinationHost, item.protocol, item.bytesBucket, item.classification, item.consentPurpose]
        );
      }
      await client.query('COMMIT');
      return { batchId: batch.batchId, accepted: batch.observations.length };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((error as { code?: string }).code === '23505') {
        const replay = new Error('batch_or_observation_replay');
        (replay as Error & { code?: string }).code = 'BATCH_REPLAY';
        throw replay;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
