import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type ConsentAction = 'grant' | 'deny' | 'revoke';
export type ConsentDecision = {
  permissionId: string;
  requestId: string;
  expectedEventSequence?: number;
  subjectId: string;
  action: ConsentAction;
  policyVersion: string;
  purposeVersion: string;
  purpose: string;
};
export type ConsentEvent = ConsentDecision & { id: string; occurredAt: string; eventSequence?: number };
export type CurrentConsent = {
  id: string;
  subjectId: string;
  purpose: string;
  policyVersion: string;
  purposeVersion: string;
  state: 'granted' | 'revoked';
};
export interface ConsentRepository {
  recordDecision(input: ConsentDecision): Promise<ConsentEvent>;
  getCurrent(permissionId: string): Promise<CurrentConsent | null>;
  getHistory(permissionId: string, subjectId: string): Promise<ConsentEvent[]>;
}

export class PostgresConsentRepository implements ConsentRepository {
  constructor(private readonly pool: Pool) {}

  async recordDecision(input: ConsentDecision): Promise<ConsentEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock both the globally unique idempotency key and the permission stream.
      // Sorting gives every transaction the same lock order and avoids deadlocks.
      const lockKeys = [`permission:${input.permissionId}`, `request:${input.requestId}`].sort();
      for (const lockKey of lockKeys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
      }
      const duplicate = await client.query<{ id: string; subject_id: string; permission_id: string; action: ConsentAction; policy_version: string; purpose_version: string; purpose: string; expected_event_sequence: number | null; event_sequence: number | string; occurred_at: Date | string }>(
        'SELECT id, subject_id, permission_id, action, policy_version, purpose_version, purpose, expected_event_sequence, event_sequence, occurred_at FROM consent_events WHERE request_id = $1',
        [input.requestId]
      );
      if (duplicate.rows[0]) {
        const row = duplicate.rows[0];
        if (row.subject_id !== input.subjectId || row.permission_id !== input.permissionId || row.action !== input.action || row.policy_version !== input.policyVersion || row.purpose_version !== input.purposeVersion || row.purpose !== input.purpose || (row.expected_event_sequence === null ? undefined : Number(row.expected_event_sequence)) !== input.expectedEventSequence) {
          const error = new Error('idempotency_key_reused_with_different_request');
          (error as Error & { code?: string }).code = 'IDEMPOTENCY_CONFLICT';
          throw error;
        }
        await client.query('COMMIT');
        return { ...input, id: row.id, eventSequence: Number(row.event_sequence), occurredAt: new Date(row.occurred_at).toISOString() };
      }
      const prior = await client.query<{ subject_id: string }>(
        'SELECT subject_id FROM consent_events WHERE permission_id = $1 ORDER BY event_sequence DESC LIMIT 1',
        [input.permissionId]
      );
      if (prior.rows[0] && prior.rows[0].subject_id !== input.subjectId) {
        const error = new Error('permission_owned_by_another_subject');
        (error as Error & { code?: string }).code = 'CONSENT_OWNER_MISMATCH';
        throw error;
      }
      const sequenceResult = await client.query<{ last_sequence: number | string }>(
        'SELECT last_sequence FROM consent_permission_sequences WHERE permission_id = $1 FOR UPDATE',
        [input.permissionId]
      );
      const currentSequence = Number(sequenceResult.rows[0]?.last_sequence ?? 0);
      if (input.expectedEventSequence !== undefined && input.expectedEventSequence !== currentSequence) {
        const error = new Error('stale_consent_decision');
        (error as Error & { code?: string }).code = 'CONSENT_STALE_DECISION';
        throw error;
      }
      const nextSequence = await client.query<{ last_sequence: number | string }>(
        `INSERT INTO consent_permission_sequences (permission_id, last_sequence)
         VALUES ($1, 1)
         ON CONFLICT (permission_id) DO UPDATE
         SET last_sequence = consent_permission_sequences.last_sequence + 1
         RETURNING last_sequence`,
        [input.permissionId]
      );
      const eventSequence = Number(nextSequence.rows[0]?.last_sequence);
      if (!Number.isSafeInteger(eventSequence)) throw new Error('consent_event_sequence_unavailable');
      const id = randomUUID();
      const result = await client.query<{ occurred_at: Date | string; event_sequence: number | string }>(
        `INSERT INTO consent_events
          (id, request_id, subject_id, permission_id, event_sequence, action, policy_version, purpose_version, purpose, expected_event_sequence, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING occurred_at, event_sequence`,
        [id, input.requestId, input.subjectId, input.permissionId, eventSequence, input.action, input.policyVersion, input.purposeVersion, input.purpose, input.expectedEventSequence ?? null, id]
      );
      const saved = result.rows[0];
      if (!saved) throw new Error('consent_event_insert_returned_no_row');
      await client.query('COMMIT');
      return { ...input, id, eventSequence: Number(saved.event_sequence), occurredAt: new Date(saved.occurred_at).toISOString() };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCurrent(permissionId: string): Promise<CurrentConsent | null> {
    const result = await this.pool.query<{
      id: string; subject_id: string; action: ConsentAction; policy_version: string;
      purpose_version: string; purpose: string; occurred_at: Date | string;
    }>(
      'SELECT id, subject_id, action, policy_version, purpose_version, purpose, occurred_at FROM consent_events WHERE permission_id = $1 ORDER BY event_sequence DESC LIMIT 1',
      [permissionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    // Purpose is persisted with each event; legacy rows are explicitly non-authorizing.
    return {
      id: permissionId, subjectId: row.subject_id, purpose: row.purpose,
      policyVersion: row.policy_version, purposeVersion: row.purpose_version,
      state: row.action === 'grant' ? 'granted' : 'revoked'
    };
  }

  async getHistory(permissionId: string, subjectId: string): Promise<ConsentEvent[]> {
    const result = await this.pool.query<{
      id: string; request_id: string; subject_id: string; action: ConsentAction; policy_version: string;
      purpose_version: string; purpose: string; expected_event_sequence: number | null; event_sequence: number | string; occurred_at: Date | string;
    }>(
      'SELECT id, request_id, subject_id, action, policy_version, purpose_version, purpose, expected_event_sequence, event_sequence, occurred_at FROM consent_events WHERE permission_id = $1 AND subject_id = $2 ORDER BY event_sequence ASC',
      [permissionId, subjectId]
    );
    return result.rows.map(row => ({
      id: row.id, permissionId, requestId: row.request_id, subjectId: row.subject_id, action: row.action,
      policyVersion: row.policy_version, purposeVersion: row.purpose_version,
      purpose: row.purpose, expectedEventSequence: row.expected_event_sequence === null ? undefined : Number(row.expected_event_sequence), eventSequence: Number(row.event_sequence), occurredAt: new Date(row.occurred_at).toISOString()
    }));
  }
}
